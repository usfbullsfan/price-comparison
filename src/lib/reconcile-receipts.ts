/**
 * Receipt reconciliation: merge data from two receipts representing the
 * same shopping trip (e.g. email receipt + website paste for the same
 * Publix visit).
 *
 * Email receipts have: abbreviated names, exact weights, promotion amounts,
 * precise totals.
 * Paste receipts have: full product names, sizes, BOGO detection, store
 * location, richer HTML structure.
 *
 * When a match is found, line items are paired and the richer data from
 * each source is merged into the earlier receipt.
 */

import { prisma } from "./db";
import type { Store } from "@prisma/client";

/**
 * After parsing a new receipt, check if there's an existing receipt from
 * a different source (EMAIL vs WEBSITE_PASTE) for the same store + date + total.
 * If found, merge the richer data from both into the earlier receipt.
 *
 * @returns true if reconciliation happened, false otherwise
 */
export async function reconcileReceipts(
  newReceiptId: string,
  store: Store,
  purchaseDate: Date,
  total: number,
  itemCount: number
): Promise<boolean> {
  const startOfDay = new Date(purchaseDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(purchaseDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Find a matching receipt from a different source
  const newReceipt = await prisma.receipt.findUnique({
    where: { id: newReceiptId },
    select: { source: true },
  });
  if (!newReceipt) return false;

  // Only reconcile EMAIL <-> WEBSITE_PASTE
  const complementarySource =
    newReceipt.source === "EMAIL" ? "WEBSITE_PASTE" :
    newReceipt.source === "WEBSITE_PASTE" ? "EMAIL" :
    null;
  if (!complementarySource) return false;

  const match = await prisma.receipt.findFirst({
    where: {
      id: { not: newReceiptId },
      store,
      source: complementarySource,
      purchaseDate: { gte: startOfDay, lte: endOfDay },
      // Total within $1 tolerance (tax rounding, slight differences)
      total: { gte: total - 1.0, lte: total + 1.0 },
      status: { not: "FAILED" },
    },
    include: {
      lineItems: true,
    },
  });

  if (!match) return false;

  // Load line items from the new receipt
  const newLineItems = await prisma.receiptLineItem.findMany({
    where: { receiptId: newReceiptId },
  });

  if (newLineItems.length === 0 || match.lineItems.length === 0) return false;

  // Determine which receipt has "richer" names (paste usually has longer names)
  const newAvgNameLen = newLineItems.reduce((s, i) => s + i.rawName.length, 0) / newLineItems.length;
  const matchAvgNameLen = match.lineItems.reduce((s, i) => s + i.rawName.length, 0) / match.lineItems.length;

  // The receipt with longer names is the "name source", the other is the "detail source"
  const nameSource = newAvgNameLen > matchAvgNameLen ? newLineItems : match.lineItems;
  const detailSource = newAvgNameLen > matchAvgNameLen ? match.lineItems : newLineItems;

  // Pair items by price proximity (within $0.05) — simple greedy matching
  const usedDetailIds = new Set<string>();
  let updatedCount = 0;

  for (const nameItem of nameSource) {
    let bestMatch: typeof detailSource[number] | null = null;
    let bestPriceDiff = Infinity;

    for (const detailItem of detailSource) {
      if (usedDetailIds.has(detailItem.id)) continue;
      const priceDiff = Math.abs(nameItem.price - detailItem.price);
      if (priceDiff <= 0.05 && priceDiff < bestPriceDiff) {
        bestPriceDiff = priceDiff;
        bestMatch = detailItem;
      }
    }

    if (!bestMatch) continue;
    usedDetailIds.add(bestMatch.id);

    // Merge: take the longer name, weight from detail source, sale info from either
    const updates: Record<string, unknown> = {};

    // Use the longer/richer name
    if (bestMatch.rawName.length > nameItem.rawName.length + 3) {
      updates.rawName = bestMatch.rawName;
    }

    // Enrich weight
    if (bestMatch.weight != null && nameItem.weight == null) {
      updates.weight = bestMatch.weight;
    }

    // Enrich sale info
    if (bestMatch.onSale && !nameItem.onSale) {
      updates.onSale = true;
      if (bestMatch.salePrice != null) updates.salePrice = bestMatch.salePrice;
      if (bestMatch.saleType) updates.saleType = bestMatch.saleType;
    } else if (!bestMatch.onSale && nameItem.onSale) {
      // nameItem already has sale info, nothing to merge
    }

    // Enrich saleType if one has it and the other doesn't
    if (bestMatch.saleType && !nameItem.saleType) {
      updates.saleType = bestMatch.saleType;
    }

    // Enrich UPC
    if (bestMatch.upc && !nameItem.upc) {
      updates.upc = bestMatch.upc;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.receiptLineItem.update({
        where: { id: nameItem.id },
        data: updates,
      });
      updatedCount++;
    }
  }

  if (updatedCount === 0) return false;

  // Mark both receipts as reconciled with each other
  await prisma.receipt.update({
    where: { id: newReceiptId },
    data: { reconciledFromId: match.id },
  });
  await prisma.receipt.update({
    where: { id: match.id },
    data: { reconciledFromId: newReceiptId },
  });

  return true;
}
