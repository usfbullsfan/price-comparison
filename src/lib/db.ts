import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    datasourceUrl: appendTimeout(process.env.DATABASE_URL),
  });

function appendTimeout(url: string | undefined): string | undefined {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  // connect_timeout=10 (seconds) prevents hanging on unreachable DB
  // pool_timeout=10 prevents waiting forever for a free connection
  if (url.includes("connect_timeout")) return url;
  return `${url}${sep}connect_timeout=10&pool_timeout=10`;
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
