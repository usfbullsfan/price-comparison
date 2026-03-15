import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Store } from "@prisma/client";
import { z } from "zod";

const CreatePriceSchema = z.object({
  productId: z.string(),
  store: z.nativeEnum(Store),
  price: z.number().positive(),
  salePrice: z.number().positive().optional(),
  onSale: z.boolean().optional(),
  date: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = CreatePriceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { date, ...rest } = parsed.data;

  const price = await prisma.price.create({
    data: {
      ...rest,
      date: date ? new Date(date) : new Date(),
    },
  });

  return NextResponse.json(price, { status: 201 });
}
