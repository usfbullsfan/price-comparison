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

  // Update or create scrape job record
  await prisma.competitorScrapeJob.upsert({
    where: { productId_store: { productId, store: store as Store } },
    update: { status: "PROCESSING", lastRunAt: new Date() },
    create: {
      productId,
      store: store as Store,
      searchQuery: product.upc ?? product.name,
      status: "PROCESSING",
      lastRunAt: new Date(),
    },
  });

  try {
    const scraped =
      store === "WALMART"
        ? await scrapeWalmartPrice(product.name, product.upc ?? undefined)
        : await scrapeTargetPrice(product.name, product.upc ?? undefined);

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
