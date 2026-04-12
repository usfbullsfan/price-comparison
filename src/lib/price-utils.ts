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

/**
 * Find the cheapest store from the latest prices.
 * Returns the store name and price, or null if no prices exist.
 */
export function cheapestStore(
  latest: Partial<Record<Store, Price>>
): { store: Store; price: Price } | null {
  let best: { store: Store; price: Price } | null = null;
  for (const [store, price] of Object.entries(latest)) {
    if (!price) continue;
    if (!best || price.price < best.price.price) {
      best = { store: store as Store, price };
    }
  }
  return best;
}

const STORE_LABELS: Record<Store, string> = {
  PUBLIX: "Publix",
  WALMART: "Walmart",
  TARGET: "Target",
  OTHER: "Other",
};

export function storeLabel(store: Store): string {
  return STORE_LABELS[store] ?? store;
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}
