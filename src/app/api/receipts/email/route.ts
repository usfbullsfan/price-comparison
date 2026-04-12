/**
 * Resend inbound email webhook endpoint.
 *
 * Setup in Resend dashboard:
 *  1. Add your domain (prices.wetpaws.dev)
 *  2. Set up an Inbound route: receipts@prices.wetpaws.dev → https://prices.wetpaws.dev/api/receipts/email
 *  3. Copy the webhook signing secret to RESEND_WEBHOOK_SECRET in your .env
 *
 * Resend sends a POST request with the email payload as JSON.
 * We validate the signature, then parse the HTML body for receipt data.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Store, Prisma } from "@prisma/client";
import {
  parsePublixEmailReceipt,
  detectStore,
  type ResendInboundPayload,
  type ParsedEmailReceipt,
} from "@/lib/parsers/receipt-email";
import { getAIProvider } from "@/lib/ai/provider";
import { persistReceiptItems } from "@/lib/normalize-product";
import { reconcileReceipts } from "@/lib/reconcile-receipts";
import { createHmac, timingSafeEqual } from "crypto";
import * as cheerio from "cheerio";

function verifyResendSignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Verify Resend webhook signature if secret is configured
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers.get("svix-signature") ?? req.headers.get("x-resend-signature");
    if (!verifyResendSignature(rawBody, sig, secret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let payload: ResendInboundPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const html = payload.html ?? "";
  const text = payload.text ?? "";

  if (!html && !text) {
    return NextResponse.json({ error: "Empty email body" }, { status: 400 });
  }

  // Detect store from sender
  const detectedStore = detectStore(payload);
  const store: Store = detectedStore ?? "PUBLIX"; // default to Publix for now

  // Create receipt record immediately
  const receipt = await prisma.receipt.create({
    data: {
      source: "EMAIL",
      store,
      rawContent: html || text,
      rawMetadata: {
        from: payload.from,
        subject: payload.subject,
        to: payload.to,
      },
      status: "PROCESSING",
    },
  });

  // Parse: AI-first, regex fallback
  try {
    let parsed: ParsedEmailReceipt;
    let parseMethod: "ai" | "regex" = "regex";

    // Extract text content for AI parsing
    const $ = cheerio.load(html || `<pre>${text}</pre>`);
    const preText = $("pre").text();
    const emailText = preText && preText.length > 50 ? preText : text;

    // Try AI parsing first
    const provider = getAIProvider();
    if (provider && emailText) {
      try {
        const aiResult = await provider.parseReceiptText(emailText, {
          store: store === "PUBLIX" ? "PUBLIX" : store,
          source: "email",
          format: preText ? "publix_pre" : "email_text",
        });

        if (aiResult.items.length > 0 && aiResult.items.every(i => i.price > 0 && i.price < 200)) {
          parseMethod = "ai";
          parsed = {
            store: "PUBLIX",
            items: aiResult.items,
            rawHtml: html || text,
            purchaseDate: aiResult.metadata.purchaseDate
              ? new Date(aiResult.metadata.purchaseDate)
              : undefined,
            total: aiResult.metadata.total,
            tax: aiResult.metadata.tax,
          };
        } else {
          console.warn("AI email parse returned invalid results, falling back to regex");
          parsed = parsePublixEmailReceipt(html || `<pre>${text}</pre>`);
        }
      } catch (err) {
        console.warn("AI email parse error, falling back to regex:", err);
        parsed = parsePublixEmailReceipt(html || `<pre>${text}</pre>`);
      }
    } else {
      parsed = parsePublixEmailReceipt(html || `<pre>${text}</pre>`);
    }

    await prisma.receiptLineItem.createMany({
      data: parsed.items.map((item) => ({
        receiptId: receipt.id,
        rawName: item.rawName,
        price: item.price,
        quantity: item.quantity ?? 1,
        onSale: item.onSale ?? false,
        salePrice: item.salePrice,
        upc: item.upc,
      })),
    });

    let debugTrace = null;
    if (parsed.items.length > 0) {
      debugTrace = await persistReceiptItems(
        receipt.id,
        store,
        parsed.purchaseDate ?? new Date(),
        parsed.items
      );
    }

    await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        status: parsed.items.length > 0 ? "DONE" : "NEEDS_REVIEW",
        parsedAt: new Date(),
        purchaseDate: parsed.purchaseDate,
        total: parsed.total,
        taxAmount: parsed.tax,
        parseMethod,
        ...(debugTrace && {
          debugData: debugTrace as unknown as Prisma.InputJsonValue,
          debugExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        }),
      },
    });

    // Try to reconcile with an existing paste receipt for the same trip
    let reconciled = false;
    if (parsed.items.length > 0 && parsed.purchaseDate && parsed.total) {
      try {
        reconciled = await reconcileReceipts(receipt.id, store, parsed.purchaseDate, parsed.total, parsed.items.length);
      } catch (err) {
        console.warn("Reconciliation failed:", err);
      }
    }

    return NextResponse.json({
      receiptId: receipt.id,
      itemCount: parsed.items.length,
      status: parsed.items.length > 0 ? "DONE" : "NEEDS_REVIEW",
      parseMethod,
      reconciled,
    });
  } catch (err) {
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        status: "FAILED",
        parseError: err instanceof Error ? err.message : "Unknown error",
      },
    });
    return NextResponse.json({ error: "Parse failed", receiptId: receipt.id }, { status: 422 });
  }
}
