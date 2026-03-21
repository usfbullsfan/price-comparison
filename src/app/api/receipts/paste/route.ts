/**
 * API endpoint for Publix website copy-paste receipt submissions.
 *
 * Users CMD+A on the Publix purchase-details page, copy, and paste
 * the text here. The parser extracts full product names, quantities,
 * prices, and savings.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Store } from "@prisma/client";
import { parsePublixPasteReceipt, parsePublixPasteHtml } from "@/lib/parsers/receipt-paste";
import { persistReceiptItems } from "@/lib/normalize-product";

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
  try {
    // Prefer HTML parsing (clipboard preserves <li> structure) with text fallback
    if (html && typeof html === "string" && html.length > 50) {
      parsed = parsePublixPasteHtml(html);
    }
    if (!parsed || parsed.items.length === 0) {
      parsed = parsePublixPasteReceipt(text);
    }
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
      include: { _count: { select: { lineItems: true } } },
    });

    if (existing && existing._count.lineItems === parsed.items.length) {
      return NextResponse.json(
        {
          error: `Duplicate receipt: this ${store} trip on ${parsed.purchaseDate.toLocaleDateString()} with $${parsed.total.toFixed(2)} total was already imported.`,
          existingReceiptId: existing.id,
        },
        { status: 409 }
      );
    }
  }

  const receipt = await prisma.receipt.create({
    data: {
      source: "WEBSITE_PASTE",
      store,
      rawContent: text,
      rawMetadata: {
        clipboardHtml: html ?? null,
        textLength: text.length,
        htmlLength: html?.length ?? 0,
        parsedSaleItems: parsed.items
          .filter((i) => i.onSale)
          .map((i) => ({ name: i.rawName, price: i.price, salePrice: i.salePrice, saleType: i.saleType })),
        parseSource: html && typeof html === "string" && html.length > 50 ? "html" : "text",
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

    await persistReceiptItems(
      receipt.id,
      store,
      parsed.purchaseDate ?? new Date(),
      parsed.items
    );

    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { status: "DONE", parsedAt: new Date() },
    });

    const saleCount = parsed.items.filter((i) => i.onSale).length;
    return NextResponse.json({
      receiptId: receipt.id,
      itemCount: parsed.items.length,
      saleCount,
      purchaseDate: parsed.purchaseDate?.toISOString() ?? null,
      total: parsed.total ?? null,
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
