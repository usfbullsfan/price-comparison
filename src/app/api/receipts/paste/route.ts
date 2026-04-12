/**
 * API endpoint for Publix website copy-paste receipt submissions.
 *
 * Users CMD+A on the Publix purchase-details page, copy, and paste
 * the text here. The parser extracts full product names, quantities,
 * prices, and savings.
 *
 * Duplicate detection: if a receipt with the same store, date, total,
 * and item count already exists, the new data is merged into the
 * existing receipt — enriching line items with any new detail (e.g.
 * weight, unit price) rather than rejecting the submission.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Store } from "@prisma/client";
import { parseReceiptPasteAI } from "@/lib/parsers/receipt-paste-ai";
import { persistReceiptItems } from "@/lib/normalize-product";
import { Prisma } from "@prisma/client";
import type { ParsedLineItem } from "@/lib/normalize-product";

export async function POST(req: NextRequest) {
  let body: { text?: string; html?: string; store?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { text, html, store: storeStr = "PUBLIX" } = body;

  if (!text || typeof text !== "string" || text.trim().length < 10) {
    return NextResponse.json({ error: "No text provided" }, { status: 400 });
  }

  const store = storeStr as Store;

  let parsed;
  let actualParseSource: "ai" | "regex" = "regex";
  try {
    // AI-first parsing with regex fallback
    parsed = await parseReceiptPasteAI(text, html, store);
    actualParseSource = parsed.parseMethod;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Parse error" },
      { status: 422 }
    );
  }

  if (parsed.items.length === 0) {
    return NextResponse.json(
      { error: "No items found in pasted text. Make sure you copied the full page with CMD+A." },
      { status: 422 }
    );
  }

  // Duplicate detection: same store + date + total + item count
  // If found, enrich existing receipt with any new detail instead of rejecting
  if (parsed.purchaseDate && parsed.total) {
    const startOfDay = new Date(parsed.purchaseDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(parsed.purchaseDate);
    endOfDay.setHours(23, 59, 59, 999);

    const existing = await prisma.receipt.findFirst({
      where: {
        store,
        purchaseDate: { gte: startOfDay, lte: endOfDay },
        total: parsed.total,
        status: { not: "FAILED" },
      },
      include: {
        lineItems: true,
        _count: { select: { lineItems: true } },
      },
    });

    if (existing && existing._count.lineItems === parsed.items.length) {
      const enrichResult = await enrichExistingReceipt(existing, parsed.items, parsed.storeLocation);

      if (enrichResult.updatedCount === 0 && !enrichResult.locationUpdated) {
        return NextResponse.json({
          receiptId: existing.id,
          itemCount: existing._count.lineItems,
          enriched: false,
          message: "Receipt already imported with same level of detail.",
        });
      }

      return NextResponse.json({
        receiptId: existing.id,
        itemCount: existing._count.lineItems,
        enriched: true,
        updatedItems: enrichResult.updatedCount,
        locationUpdated: enrichResult.locationUpdated,
        message: `Enriched existing receipt: updated ${enrichResult.updatedCount} item(s)${enrichResult.locationUpdated ? " and store location" : ""}.`,
      });
    }
  }

  const receipt = await prisma.receipt.create({
    data: {
      source: "WEBSITE_PASTE",
      store,
      storeLocation: parsed.storeLocation,
      rawContent: text,
      rawMetadata: {
        clipboardHtml: html ?? null,
        textLength: text.length,
        htmlLength: html?.length ?? 0,
        parsedSaleItems: parsed.items
          .filter((i) => i.onSale)
          .map((i) => ({ name: i.rawName, price: i.price, salePrice: i.salePrice, saleType: i.saleType })),
        parseSource: actualParseSource,
      },
      status: "PROCESSING",
      purchaseDate: parsed.purchaseDate,
      total: parsed.total,
    },
  });

  try {
    await prisma.receiptLineItem.createMany({
      data: parsed.items.map((item) => ({
        receiptId: receipt.id,
        rawName: item.rawName,
        price: item.price,
        quantity: item.quantity ?? 1,
        weight: item.weight,
        onSale: item.onSale ?? false,
        salePrice: item.salePrice,
        saleType: item.saleType,
      })),
    });

    const debugTrace = await persistReceiptItems(
      receipt.id,
      store,
      parsed.purchaseDate ?? new Date(),
      parsed.items
    );

    await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        status: "DONE",
        parsedAt: new Date(),
        debugData: debugTrace as unknown as Prisma.InputJsonValue,
        debugExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
    });

    const saleCount = parsed.items.filter((i) => i.onSale).length;
    return NextResponse.json({
      receiptId: receipt.id,
      itemCount: parsed.items.length,
      saleCount,
      purchaseDate: parsed.purchaseDate?.toISOString() ?? null,
      total: parsed.total ?? null,
      storeLocation: parsed.storeLocation ?? null,
    });
  } catch (err) {
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        status: "FAILED",
        parseError: err instanceof Error ? err.message : "Unknown error",
      },
    });
    return NextResponse.json(
      { error: "Failed to persist items", receiptId: receipt.id },
      { status: 500 }
    );
  }
}

/**
 * Enrich an existing receipt's line items with more detailed data from a
 * new parse. Matches items by name similarity + price, then updates any
 * fields where the new data is more detailed (e.g. has weight when the
 * old one didn't, or has a sale type that was missing).
 */
async function enrichExistingReceipt(
  existing: {
    id: string;
    storeLocation: string | null;
    lineItems: {
      id: string;
      rawName: string;
      price: number;
      quantity: number;
      weight: number | null;
      onSale: boolean;
      salePrice: number | null;
      saleType: string | null;
    }[];
  },
  newItems: ParsedLineItem[],
  newLocation: string | undefined
): Promise<{ updatedCount: number; locationUpdated: boolean }> {
  let updatedCount = 0;
  let locationUpdated = false;

  // Update store location if we have one and the existing receipt doesn't
  if (newLocation && !existing.storeLocation) {
    await prisma.receipt.update({
      where: { id: existing.id },
      data: { storeLocation: newLocation },
    });
    locationUpdated = true;
  }

  // Match new items to existing line items by normalized name + price
  const usedExisting = new Set<string>();

  for (const newItem of newItems) {
    const match = findBestMatch(newItem, existing.lineItems, usedExisting);
    if (!match) continue;
    usedExisting.add(match.id);

    // Determine what fields the new parse has that the existing one doesn't
    const updates: Record<string, unknown> = {};

    // Enrich weight if new data has it and existing doesn't
    if (newItem.weight != null && match.weight == null) {
      updates.weight = newItem.weight;
    }

    // Enrich sale info if new data has it and existing doesn't
    if (newItem.onSale && !match.onSale) {
      updates.onSale = true;
      if (newItem.salePrice != null) updates.salePrice = newItem.salePrice;
      if (newItem.saleType) updates.saleType = newItem.saleType;
    }

    // If new parse has a sale type but existing doesn't (both on sale)
    if (newItem.saleType && !match.saleType && match.onSale) {
      updates.saleType = newItem.saleType;
    }

    // Update the raw name if the new one is longer/more descriptive
    if (newItem.rawName.length > match.rawName.length + 5) {
      updates.rawName = newItem.rawName;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.receiptLineItem.update({
        where: { id: match.id },
        data: updates,
      });
      updatedCount++;
    }
  }

  return { updatedCount, locationUpdated };
}

/**
 * Find the best matching existing line item for a new parsed item.
 * Matches on normalized name similarity and price proximity.
 */
function findBestMatch(
  newItem: ParsedLineItem,
  existingItems: {
    id: string;
    rawName: string;
    price: number;
    quantity: number;
    weight: number | null;
    onSale: boolean;
    salePrice: number | null;
    saleType: string | null;
  }[],
  usedIds: Set<string>
): (typeof existingItems)[number] | null {
  const newNameNorm = newItem.rawName.toLowerCase().replace(/[^a-z0-9]/g, "");
  let bestMatch: (typeof existingItems)[number] | null = null;
  let bestScore = 0;

  for (const existing of existingItems) {
    if (usedIds.has(existing.id)) continue;

    // Price must be within 2 cents
    if (Math.abs(existing.price - newItem.price) > 0.02) continue;

    const existingNorm = existing.rawName.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Exact normalized match
    if (newNameNorm === existingNorm) return existing;

    // Substring containment (one name contains the other)
    if (newNameNorm.includes(existingNorm) || existingNorm.includes(newNameNorm)) {
      const score = Math.min(newNameNorm.length, existingNorm.length) / Math.max(newNameNorm.length, existingNorm.length);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = existing;
      }
      continue;
    }

    // Common prefix ratio
    const prefixLen = commonPrefix(newNameNorm, existingNorm);
    const ratio = prefixLen / Math.max(newNameNorm.length, existingNorm.length);
    if (ratio > 0.6 && ratio > bestScore) {
      bestScore = ratio;
      bestMatch = existing;
    }
  }

  return bestMatch;
}

function commonPrefix(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
}
