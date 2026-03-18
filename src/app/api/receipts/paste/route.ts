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

  const receipt = await prisma.receipt.create({
    data: {
      source: "WEBSITE_PASTE",
      store,
      rawContent: text,
      status: "PROCESSING",
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
      })),
    });

    await persistReceiptItems(
      receipt.id,
      store,
      new Date(),
      parsed.items
    );

    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { status: "DONE", parsedAt: new Date() },
    });

    return NextResponse.json({
      receiptId: receipt.id,
      itemCount: parsed.items.length,
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
