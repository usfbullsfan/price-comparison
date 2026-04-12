import { describe, it, expect } from "vitest";
import {
  normalizeName,
  formatPrice,
  computeUnitPrice,
  savingsVsPublix,
  cheapestStore,
  storeLabel,
} from "@/lib/price-utils";
import { Store } from "@prisma/client";

describe("normalizeName", () => {
  it("lowercases and trims", () => {
    expect(normalizeName("  Hello World  ")).toBe("hello world");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeName("Publix   Whole    Milk")).toBe("publix whole milk");
  });

  it("handles empty string", () => {
    expect(normalizeName("")).toBe("");
  });

  it("handles single word", () => {
    expect(normalizeName("BUTTER")).toBe("butter");
  });
});

describe("formatPrice", () => {
  it("formats a whole number", () => {
    expect(formatPrice(5)).toBe("$5.00");
  });

  it("formats cents correctly", () => {
    expect(formatPrice(3.5)).toBe("$3.50");
  });

  it("formats precise prices", () => {
    expect(formatPrice(12.99)).toBe("$12.99");
  });
});

describe("computeUnitPrice", () => {
  it("divides price by unit size", () => {
    expect(computeUnitPrice(8, 32)).toBeCloseTo(0.25);
  });

  it("returns null for zero unit size", () => {
    expect(computeUnitPrice(5, 0)).toBeNull();
  });

  it("returns null for null unit size", () => {
    expect(computeUnitPrice(5, null)).toBeNull();
  });

  it("returns null for undefined unit size", () => {
    expect(computeUnitPrice(5, undefined)).toBeNull();
  });
});

describe("savingsVsPublix", () => {
  it("calculates positive savings", () => {
    expect(savingsVsPublix(5.79, 3.48)).toBeCloseTo(2.31);
  });

  it("calculates negative savings (competitor more expensive)", () => {
    expect(savingsVsPublix(3.00, 4.50)).toBeCloseTo(-1.50);
  });

  it("returns null when publix price is missing", () => {
    expect(savingsVsPublix(undefined, 3.00)).toBeNull();
  });

  it("returns null when competitor price is missing", () => {
    expect(savingsVsPublix(5.79, undefined)).toBeNull();
  });
});

function makePrice(store: Store, price: number): import("@prisma/client").Price {
  return {
    id: `test-${store}-${price}`,
    productId: "prod1",
    store,
    price,
    salePrice: null,
    onSale: false,
    saleType: null,
    unitPrice: null,
    date: new Date("2026-03-15"),
    receiptId: null,
    notes: null,
    createdAt: new Date(),
  };
}

describe("cheapestStore", () => {
  it("finds the cheapest store", () => {
    const latest = {
      [Store.PUBLIX]: makePrice(Store.PUBLIX, 5.79),
      [Store.WALMART]: makePrice(Store.WALMART, 3.48),
      [Store.TARGET]: makePrice(Store.TARGET, 4.99),
    };
    const result = cheapestStore(latest);
    expect(result?.store).toBe(Store.WALMART);
    expect(result?.price.price).toBe(3.48);
  });

  it("returns null when no prices", () => {
    expect(cheapestStore({})).toBeNull();
  });

  it("handles single store", () => {
    const latest = {
      [Store.PUBLIX]: makePrice(Store.PUBLIX, 5.79),
    };
    const result = cheapestStore(latest);
    expect(result?.store).toBe(Store.PUBLIX);
  });
});

describe("storeLabel", () => {
  it("returns Publix for PUBLIX", () => {
    expect(storeLabel(Store.PUBLIX)).toBe("Publix");
  });

  it("returns Walmart for WALMART", () => {
    expect(storeLabel(Store.WALMART)).toBe("Walmart");
  });

  it("returns Target for TARGET", () => {
    expect(storeLabel(Store.TARGET)).toBe("Target");
  });
});
