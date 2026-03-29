import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * DELETE /api/receipts
 *
 * Purge all receipts and their associated data (prices, line items).
 * Useful for troubleshooting / starting fresh.
 */
export async function DELETE() {
  // Delete prices linked to receipts first (SetNull FK, so we clean them explicitly)
  await prisma.price.deleteMany({ where: { receiptId: { not: null } } });

  // Receipts + cascade-deleted ReceiptLineItems
  const result = await prisma.receipt.deleteMany();

  return NextResponse.json({ deleted: result.count });
}
