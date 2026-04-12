import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Store } from "@prisma/client";
import { scrapeWalmartPrice } from "@/lib/scrapers/walmart";
import { scrapeTargetPrice } from "@/lib/scrapers/target";
import { z } from "zod";

const ScrapeSchema = z.object({
  productId: z.string(),
  store: z.enum(["WALMART", "TARGET"]),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = ScrapeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { productId, store } = parsed.data;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const searchQuery = buildSearchQuery(product);

  // Update or create scrape job record
  await prisma.competitorScrapeJob.upsert({
    where: { productId_store: { productId, store: store as Store } },
    update: { status: "PROCESSING", lastRunAt: new Date(), searchQuery },
    create: {
      productId,
      store: store as Store,
      searchQuery,
      status: "PROCESSING",
      lastRunAt: new Date(),
    },
  });

  try {
    const scraped =
      store === "WALMART"
        ? await scrapeWalmartPrice(searchQuery, product.upc ?? undefined)
        : await scrapeTargetPrice(searchQuery, product.upc ?? undefined);

    if (!scraped) {
      await prisma.competitorScrapeJob.update({
        where: { productId_store: { productId, store: store as Store } },
        data: { status: "FAILED", error: "No results found" },
      });
      return NextResponse.json({ error: "No results found for this product" }, { status: 404 });
    }

    // Save price
    const price = await prisma.price.create({
      data: {
        productId,
        store: store as Store,
        price: scraped.price,
        salePrice: scraped.salePrice,
        onSale: scraped.onSale,
        date: new Date(),
        notes: scraped.url,
      },
    });

    // Update product image if we found one and don't have one yet
    if (scraped.imageUrl && !product.imageUrl) {
      await prisma.product.update({
        where: { id: productId },
        data: { imageUrl: scraped.imageUrl },
      });
    }

    await prisma.competitorScrapeJob.update({
      where: { productId_store: { productId, store: store as Store } },
      data: {
        status: "DONE",
        error: null,
        url: scraped.url,
        nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // retry in 24h
      },
    });

    return NextResponse.json({ price, scraped });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.competitorScrapeJob.update({
      where: { productId_store: { productId, store: store as Store } },
      data: { status: "FAILED", error: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Build a semantic search query from product attributes.
 * Uses productType + variety + size instead of raw receipt name,
 * which produces much better results at competitor stores.
 *
 * "PUBLIX DELI RSTD TURK 8OZ" → "deli turkey roasted 8 oz"
 */
function buildSearchQuery(product: {
  name: string;
  productType: string | null;
  variety: string | null;
  size: string | null;
  brand: string | null;
  isStoreGeneric: boolean;
}): string {
  const parts: string[] = [];

  if (product.productType) parts.push(product.productType);
  if (product.variety) parts.push(product.variety);
  if (product.size) parts.push(product.size);

  // Include brand only if it's not a store generic (don't search "Publix" at Walmart)
  if (product.brand && !product.isStoreGeneric) {
    parts.push(product.brand);
  }

  return parts.length > 0 ? parts.join(" ") : product.name;
}
