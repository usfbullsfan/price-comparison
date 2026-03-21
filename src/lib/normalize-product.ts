import { prisma } from "./db";
import { Store } from "@prisma/client";
import { normalizeName } from "./price-utils";

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

  // Create new product
  const created = await prisma.product.create({
    data: {
      name: titleCase(item.rawName),
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
 */
export async function persistReceiptItems(
  receiptId: string,
  store: Store,
  date: Date,
  items: ParsedLineItem[]
): Promise<void> {
  for (const item of items) {
    const productId = await findOrCreateProduct(item);
    const effectivePrice = item.onSale && item.salePrice ? item.salePrice : item.price;

    // Update the ReceiptLineItem to matched
    await prisma.receiptLineItem.updateMany({
      where: { receiptId, rawName: item.rawName, matched: false },
      data: { matched: true, productId },
    });

    // Create Price record
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
