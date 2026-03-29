import { prisma } from "./db";
import { Store } from "@prisma/client";
import { normalizeName } from "./price-utils";
import { getAIProvider } from "./ai/provider";

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
): Promise<void> {
  // Phase 1: Resolve existing products and collect names needing AI normalization
  const resolved: { item: ParsedLineItem; productId: string | null }[] = [];
  const needsNormalization: { index: number; rawName: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Try UPC match
    if (item.upc) {
      const existing = await prisma.product.findUnique({ where: { upc: item.upc } });
      if (existing) {
        resolved.push({ item, productId: existing.id });
        continue;
      }
    }

    // Try normalized name match
    const normalized = normalizeName(item.rawName);
    const byName = await prisma.product.findFirst({
      where: { normalizedName: normalized },
    });
    if (byName) {
      resolved.push({ item, productId: byName.id });
      continue;
    }

    // Needs a new product — collect for batch normalization
    resolved.push({ item, productId: null });
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
      } catch {
        // AI failure is non-critical
      }
    }
  }

  // Phase 3: Create missing products and persist all price records
  for (const { item, productId: existingId } of resolved) {
    let productId = existingId;

    if (!productId) {
      const displayName = displayNames[item.rawName] ?? titleCase(item.rawName);
      const created = await prisma.product.create({
        data: {
          name: displayName,
          normalizedName: normalizeName(item.rawName),
          upc: item.upc,
        },
      });
      productId = created.id;
    }

    await prisma.receiptLineItem.updateMany({
      where: { receiptId, rawName: item.rawName, matched: false },
      data: { matched: true, productId },
    });

    await prisma.price.create({
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
  }
}
