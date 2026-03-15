import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/price-utils";
import { z } from "zod";

const CreateProductSchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().optional(),
  size: z.string().optional(),
  unit: z.string().optional(),
  unitSize: z.number().positive().optional(),
  upc: z.string().optional(),
  category: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");

  const products = await prisma.product.findMany({
    where: q
      ? {
          OR: [
            { normalizedName: { contains: q.toLowerCase() } },
            { brand: { contains: q, mode: "insensitive" } },
            { upc: q },
          ],
        }
      : undefined,
    include: {
      prices: {
        orderBy: { date: "desc" },
        take: 20,
      },
    },
    orderBy: { name: "asc" },
    take: 100,
  });

  return NextResponse.json(products);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = CreateProductSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  // Check for duplicate by UPC or normalized name
  if (data.upc) {
    const existing = await prisma.product.findUnique({ where: { upc: data.upc } });
    if (existing) {
      return NextResponse.json({ error: "Product with this UPC already exists", existing }, { status: 409 });
    }
  }

  const product = await prisma.product.create({
    data: {
      ...data,
      normalizedName: normalizeName(data.name),
    },
  });

  return NextResponse.json(product, { status: 201 });
}
