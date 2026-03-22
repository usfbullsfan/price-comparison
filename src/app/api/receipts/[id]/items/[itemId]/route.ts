import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; itemId: string }> }
) {
  const params = await props.params;
  const { id: receiptId, itemId } = params;

  const item = await prisma.receiptLineItem.findFirst({
    where: { id: itemId, receiptId },
  });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only allow editing specific fields
  const updates: Record<string, unknown> = {};
  if (typeof body.rawName === "string" && body.rawName.trim()) updates.rawName = body.rawName.trim();
  if (typeof body.price === "number" && body.price >= 0) updates.price = body.price;
  if (typeof body.salePrice === "number") updates.salePrice = body.salePrice || null;
  if (typeof body.quantity === "number" && body.quantity >= 1) updates.quantity = Math.round(body.quantity);
  if (typeof body.weight === "number") updates.weight = body.weight || null;
  if (typeof body.onSale === "boolean") updates.onSale = body.onSale;
  if (body.saleType !== undefined) updates.saleType = body.saleType || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await prisma.receiptLineItem.update({
    where: { id: itemId },
    data: updates,
  });

  // Also update the corresponding Price record if price-related fields changed
  if (updates.price !== undefined || updates.salePrice !== undefined || updates.onSale !== undefined) {
    const priceRecord = await prisma.price.findFirst({
      where: { receiptId, product: { normalizedName: item.rawName.toLowerCase().replace(/\s+/g, " ").trim() } },
    });
    if (priceRecord) {
      await prisma.price.update({
        where: { id: priceRecord.id },
        data: {
          price: (updates.price as number) ?? item.price,
          salePrice: updates.salePrice !== undefined ? (updates.salePrice as number | null) : item.salePrice,
          onSale: (updates.onSale as boolean) ?? item.onSale,
          saleType: updates.saleType !== undefined ? (updates.saleType as string | null) : undefined,
        },
      });
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; itemId: string }> }
) {
  const params = await props.params;
  const { id: receiptId, itemId } = params;

  const item = await prisma.receiptLineItem.findFirst({
    where: { id: itemId, receiptId },
  });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Remove associated Price record
  if (item.productId) {
    await prisma.price.deleteMany({
      where: { receiptId, productId: item.productId },
    });
  }

  await prisma.receiptLineItem.delete({ where: { id: itemId } });

  return NextResponse.json({ ok: true });
}
