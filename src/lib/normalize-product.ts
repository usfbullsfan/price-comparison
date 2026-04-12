import { prisma } from "./db";
import { Store } from "@prisma/client";
import { normalizeName } from "./price-utils";
import { getAIProvider } from "./ai/provider";
import { findAndLinkCrossStoreMatches } from "./matching/cross-store-matcher";

export interface ParsedLineItem {
  rawName: string;
  price: number;       // regular unit price
  quantity?: number;
  weight?: number;
  onSale?: boolean;
  salePrice?: number;  // sale unit price (what was actually paid per unit)
  saleType?: string;   // "BOGO", "SALE"
  upc?: string;
}

export interface DebugTrace {
  parsedItems: ParsedLineItem[];
  itemResolutions: {
    rawName: string;
    matchType: "upc" | "name" | "new";
    productId: string;
    displayName: string;
  }[];
  aiNormalization?: { input: string[]; output: Record<string, string> };
  createdProducts: { id: string; name: string; normalizedName: string }[];
  createdPrices: { id: string; productId: string; price: number; store: string }[];
}

/**
 * Given a parsed line item, find or create a matching Product and return its id.
 * Uses UPC first (exact match), then normalized name (fuzzy fallback).
 */
export async function findOrCreateProduct(item: ParsedLineItem): Promise<string> {
  // Try UPC match first
  if (item.upc) {
    const existing = await prisma.product.findUnique({ where: { upc: item.upc } });
    if (existing) return existing.id;
  }

  // Try normalized name match
  const normalized = normalizeName(item.rawName);
  const byName = await prisma.product.findFirst({
    where: { normalizedName: normalized },
  });
  if (byName) return byName.id;

  // Create new product — use AI for a cleaner display name if available
  let displayName = titleCase(item.rawName);
  const ai = getAIProvider();
  if (ai) {
    try {
      displayName = await ai.normalizeProductName(item.rawName);
    } catch {
      // AI failure is non-critical, fall back to titleCase
    }
  }

  const created = await prisma.product.create({
    data: {
      name: displayName,
      normalizedName: normalized,
      upc: item.upc,
    },
  });
  return created.id;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Persist line items from a receipt to Price records, matching/creating Products.
 *
 * Batches AI normalization into a single call to avoid N sequential API requests.
 */
export async function persistReceiptItems(
  receiptId: string,
  store: Store,
  date: Date,
  items: ParsedLineItem[]
): Promise<DebugTrace> {
  const debug: DebugTrace = {
    parsedItems: items,
    itemResolutions: [],
    createdProducts: [],
    createdPrices: [],
  };

  // Phase 1: Resolve existing products and collect names needing AI normalization
  const resolved: { item: ParsedLineItem; productId: string | null; matchType: "upc" | "name" | "new"; matchedName?: string }[] = [];
  const needsNormalization: { index: number; rawName: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Try UPC match
    if (item.upc) {
      const existing = await prisma.product.findUnique({ where: { upc: item.upc } });
      if (existing) {
        resolved.push({ item, productId: existing.id, matchType: "upc", matchedName: existing.name });
        continue;
      }
    }

    // Try normalized name match
    const normalized = normalizeName(item.rawName);
    const byName = await prisma.product.findFirst({
      where: { normalizedName: normalized },
    });
    if (byName) {
      resolved.push({ item, productId: byName.id, matchType: "name", matchedName: byName.name });
      continue;
    }

    // Needs a new product — collect for batch normalization
    resolved.push({ item, productId: null, matchType: "new" });
    needsNormalization.push({ index: i, rawName: item.rawName });
  }

  // Phase 2: Batch-normalize all new product names in one AI call
  let displayNames: Record<string, string> = {};
  if (needsNormalization.length > 0) {
    const ai = getAIProvider();
    if (ai) {
      try {
        displayNames = await ai.normalizeProductNames(
          needsNormalization.map((n) => n.rawName)
        );
        debug.aiNormalization = {
          input: needsNormalization.map((n) => n.rawName),
          output: displayNames,
        };
      } catch {
        // AI failure is non-critical
      }
    }
  }

  // Phase 3: Create missing products and persist all price records
  for (const { item, productId: existingId, matchType, matchedName } of resolved) {
    let productId = existingId;
    let displayName = matchedName ?? "";

    if (!productId) {
      displayName = displayNames[item.rawName] ?? titleCase(item.rawName);
      const normalizedName = normalizeName(item.rawName);
      const created = await prisma.product.create({
        data: {
          name: displayName,
          normalizedName,
          upc: item.upc,
        },
      });
      productId = created.id;
      debug.createdProducts.push({ id: created.id, name: displayName, normalizedName });
    }

    debug.itemResolutions.push({
      rawName: item.rawName,
      matchType,
      productId,
      displayName,
    });

    await prisma.receiptLineItem.updateMany({
      where: { receiptId, rawName: item.rawName, matched: false },
      data: { matched: true, productId },
    });

    const price = await prisma.price.create({
      data: {
        productId,
        store,
        price: item.price,
        salePrice: item.salePrice,
        onSale: item.onSale ?? false,
        saleType: item.saleType,
        date,
        receiptId,
      },
    });
    debug.createdPrices.push({
      id: price.id,
      productId,
      price: item.price,
      store,
    });
  }

  // Phase 4: Batch-extract product attributes for newly created products
  if (debug.createdProducts.length > 0) {
    const ai = getAIProvider();
    if (ai) {
      try {
        const rawNames = debug.createdProducts.map((p) => p.name);
        const attributes = await ai.extractProductAttributes(rawNames);

        for (let i = 0; i < debug.createdProducts.length; i++) {
          const attrs = attributes[i];
          if (!attrs || attrs.productType === "unknown") continue;

          await prisma.product.update({
            where: { id: debug.createdProducts[i].id },
            data: {
              productType: attrs.productType,
              variety: attrs.variety ?? undefined,
              brand: attrs.brand ?? undefined,
              size: attrs.size ?? undefined,
              unit: attrs.unit ?? undefined,
              unitSize: attrs.unitSize ?? undefined,
              category: attrs.category ?? undefined,
              isStoreGeneric: attrs.isStoreGeneric ?? false,
            },
          });
        }
      } catch {
        // AI attribute extraction failure is non-critical
      }
    }

    // Phase 5: Find cross-store matches for new products
    for (const created of debug.createdProducts) {
      try {
        await findAndLinkCrossStoreMatches(created.id);
      } catch {
        // Cross-store matching failure is non-critical
      }
    }
  }

  return debug;
}
