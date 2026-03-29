import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/debug/cleanup
 *
 * Nulls out expired debugData on receipts (retention: 3 days).
 * Can be called manually or via an external cron service (e.g. cron-job.org).
 */
export async function GET() {
  const result = await prisma.receipt.updateMany({
    where: {
      debugExpiresAt: { lt: new Date() },
      debugData: { not: Prisma.JsonNull },
    },
    data: {
      debugData: Prisma.JsonNull,
      debugExpiresAt: null,
    },
  });

  return NextResponse.json({ cleaned: result.count });
}
