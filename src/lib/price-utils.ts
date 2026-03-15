import { Price, Store } from "@prisma/client";

export function formatPrice(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

export function latestPriceByStore(
  prices: Price[]
): Partial<Record<Store, Price>> {
  const result: Partial<Record<Store, Price>> = {};
  for (const price of prices) {
    const existing = result[price.store];
    if (!existing || price.date > existing.date) {
      result[price.store] = price;
    }
  }
  return result;
}

export function computeUnitPrice(
  price: number,
  unitSize: number | null | undefined
): number | null {
  if (!unitSize || unitSize <= 0) return null;
  return price / unitSize;
}

export function savingsVsPublix(
  publixPrice: number | undefined,
  competitorPrice: number | undefined
): number | null {
  if (publixPrice == null || competitorPrice == null) return null;
  return publixPrice - competitorPrice;
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}
