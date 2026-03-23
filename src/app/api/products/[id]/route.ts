import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/price-utils";
import { z } from "zod";

const UpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  brand: z.string().optional(),
  size: z.string().optional(),
  unit: z.string().optional(),
  unitSize: z.number().positive().optional(),
  upc: z.string().optional(),
  category: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: {
      prices: {
        orderBy: { date: "desc" },
        include: { receipt: { select: { id: true, source: true } } },
      },
    },
  });

  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(product);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const body = await req.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.name) {
    data.normalizedName = normalizeName(parsed.data.name);
  }

  const product = await prisma.product.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json(product);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await prisma.product.delete({ where: { id: params.id } });
  return new NextResponse(null, { status: 204 });
}
