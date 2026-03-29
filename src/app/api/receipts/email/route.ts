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
} from "@/lib/parsers/receipt-email";
import { persistReceiptItems } from "@/lib/normalize-product";
import { createHmac, timingSafeEqual } from "crypto";

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

  // Parse and persist (in-line for email since it's fast)
  try {
    const parsed = parsePublixEmailReceipt(html || `<pre>${text}</pre>`);

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
        ...(debugTrace && {
          debugData: debugTrace as unknown as Prisma.InputJsonValue,
          debugExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        }),
      },
    });

    return NextResponse.json({
      receiptId: receipt.id,
      itemCount: parsed.items.length,
      status: parsed.items.length > 0 ? "DONE" : "NEEDS_REVIEW",
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
