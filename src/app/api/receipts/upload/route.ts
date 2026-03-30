import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Store, Prisma } from "@prisma/client";
import { parseReceiptImage } from "@/lib/parsers/receipt-image";
import { parseDevToolsJson } from "@/lib/parsers/receipt-devtools";
import { persistReceiptItems } from "@/lib/normalize-product";
import { requireAuth } from "@/lib/auth";

// Max 20MB upload size (Next.js App Router route segment config)
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const contentType = req.headers.get("content-type") ?? "";

  // --- Image upload ---
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const storeStr = (formData.get("store") as string | null) ?? "PUBLIX";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const store = storeStr as Store;
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "image/jpeg";

    // Create receipt record
    const receipt = await prisma.receipt.create({
      data: {
        source: "IMAGE_UPLOAD",
        store,
        rawContent: buffer.toString("base64"),
        rawMetadata: { filename: file.name, mimeType, size: file.size },
        status: "PROCESSING",
      },
    });

    // Parse in background (don't block the response) with a 2-minute timeout
    const PARSE_TIMEOUT_MS = 120_000;
    let timer: ReturnType<typeof setTimeout>;
    Promise.race([
      parseAndPersist(receipt.id, store, buffer, mimeType),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("parseAndPersist timed out")), PARSE_TIMEOUT_MS);
      }),
    ])
      .catch(async (err) => {
        // Mark receipt as failed so it doesn't stay stuck in PROCESSING
        try {
          await prisma.receipt.update({
            where: { id: receipt.id },
            data: {
              status: "FAILED",
              parseError: err instanceof Error ? err.message : "Background parse failed",
            },
          });
        } catch {
          // DB update failed too — nothing more we can do
        }
      })
      .finally(() => clearTimeout(timer));

    return NextResponse.json({ receiptId: receipt.id, status: "PROCESSING" }, { status: 202 });
  }

  // --- DevTools JSON paste ---
  if (contentType.includes("application/json")) {
    const body = await req.json();
    const { json, store: storeStr = "PUBLIX" } = body as {
      json?: string;
      store?: string;
    };

    if (!json) {
      return NextResponse.json({ error: "No JSON provided" }, { status: 400 });
    }

    const store = storeStr as Store;

    let parsed;
    try {
      parsed = parseDevToolsJson(json);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Parse error" },
        { status: 422 }
      );
    }

    const receipt = await prisma.receipt.create({
      data: {
        source: "DEVTOOLS_JSON",
        store,
        rawContent: json,
        rawMetadata: { detectedFormat: parsed.detectedFormat },
        status: "PROCESSING",
        purchaseDate: parsed.purchaseDate,
        total: parsed.total,
      },
    });

    // Create line items
    if (parsed.items.length > 0) {
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
    } else {
      await prisma.receipt.update({
        where: { id: receipt.id },
        data: { status: "DONE", parsedAt: new Date() },
      });
    }

    return NextResponse.json({
      receiptId: receipt.id,
      itemCount: parsed.items.length,
      detectedFormat: parsed.detectedFormat,
    });
  }

  return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
}

async function parseAndPersist(
  receiptId: string,
  store: Store,
  buffer: Buffer,
  mimeType: string
) {
  try {
    const parsed = await parseReceiptImage(buffer, mimeType);

    await prisma.receiptLineItem.createMany({
      data: parsed.items.map((item) => ({
        receiptId,
        rawName: item.rawName,
        price: item.price,
        quantity: item.quantity ?? 1,
        onSale: item.onSale ?? false,
        salePrice: item.salePrice,
        upc: item.upc,
      })),
    });

    const debugTrace = await persistReceiptItems(
      receiptId,
      store,
      parsed.purchaseDate ?? new Date(),
      parsed.items
    );

    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        status: parsed.items.length > 0 ? "DONE" : "NEEDS_REVIEW",
        parsedAt: new Date(),
        purchaseDate: parsed.purchaseDate,
        total: parsed.total,
        taxAmount: parsed.tax,
        debugData: debugTrace as unknown as Prisma.InputJsonValue,
        debugExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
    });
  } catch (err) {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        status: "FAILED",
        parseError: err instanceof Error ? err.message : "Unknown error",
      },
    });
  }
}
