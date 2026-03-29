import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;

  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: {
      lineItems: {
        orderBy: { createdAt: "asc" },
        include: {
          // No relation on ReceiptLineItem to Product, so we'll look up separately
        },
      },
      items: {
        orderBy: { date: "desc" },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              normalizedName: true,
              brand: true,
              size: true,
              unit: true,
              upc: true,
              category: true,
            },
          },
        },
      },
    },
  });

  if (!receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  // Collect unique products linked via prices
  const productsMap = new Map<string, typeof receipt.items[0]["product"]>();
  for (const price of receipt.items) {
    if (!productsMap.has(price.productId)) {
      productsMap.set(price.productId, price.product);
    }
  }

  return NextResponse.json({
    receipt: {
      id: receipt.id,
      source: receipt.source,
      store: receipt.store,
      status: receipt.status,
      purchaseDate: receipt.purchaseDate,
      total: receipt.total,
      taxAmount: receipt.taxAmount,
      createdAt: receipt.createdAt,
      parsedAt: receipt.parsedAt,
      parseError: receipt.parseError,
    },
    rawInput: {
      content: receipt.rawContent,
      metadata: receipt.rawMetadata,
    },
    debugTrace: receipt.debugData ?? null,
    debugExpiresAt: receipt.debugExpiresAt,
    finalData: {
      lineItems: receipt.lineItems.map((li) => ({
        id: li.id,
        rawName: li.rawName,
        price: li.price,
        quantity: li.quantity,
        weight: li.weight,
        onSale: li.onSale,
        salePrice: li.salePrice,
        saleType: li.saleType,
        upc: li.upc,
        matched: li.matched,
        productId: li.productId,
      })),
      products: Array.from(productsMap.values()),
      prices: receipt.items.map((p) => ({
        id: p.id,
        productId: p.productId,
        store: p.store,
        price: p.price,
        salePrice: p.salePrice,
        onSale: p.onSale,
        saleType: p.saleType,
        unitPrice: p.unitPrice,
        date: p.date,
      })),
    },
  });
}
