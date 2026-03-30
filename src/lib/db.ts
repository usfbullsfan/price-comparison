import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
  cleanupInterval: ReturnType<typeof setInterval> | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasourceUrl: appendPoolParams(process.env.DATABASE_URL ?? ""),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Auto-cleanup expired debug data every 6 hours (avoids DB bloat)
if (!globalForPrisma.cleanupInterval) {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  globalForPrisma.cleanupInterval = setInterval(async () => {
    try {
      const { Prisma } = await import("@prisma/client");
      await prisma.receipt.updateMany({
        where: {
          debugExpiresAt: { lt: new Date() },
          debugData: { not: Prisma.JsonNull },
        },
        data: { debugData: Prisma.JsonNull, debugExpiresAt: null },
      });
    } catch {
      // Silently ignore cleanup errors — non-critical
    }
  }, SIX_HOURS);
  // Don't block process exit
  if (globalForPrisma.cleanupInterval.unref) {
    globalForPrisma.cleanupInterval.unref();
  }
}

/** Append connection pool parameters if not already present */
function appendPoolParams(url: string): string {
  if (!url || url.includes("connection_limit")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}connection_limit=10&pool_timeout=10`;
}
