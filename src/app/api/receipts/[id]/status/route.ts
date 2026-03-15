import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      parseError: true,
      parsedAt: true,
      _count: { select: { lineItems: true } },
    },
  });

  if (!receipt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(receipt);
}
