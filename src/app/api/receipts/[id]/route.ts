import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  const receipt = await prisma.receipt.findUnique({ where: { id } });
  if (!receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  // Delete associated Price records first (they reference receipt via SetNull,
  // but we want to clean them up since the data is invalid without the receipt)
  await prisma.price.deleteMany({ where: { receiptId: id } });

  // ReceiptLineItems cascade-delete via schema, so just delete the receipt
  await prisma.receipt.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
