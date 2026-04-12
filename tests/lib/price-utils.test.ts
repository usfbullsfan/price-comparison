import { describe, it, expect } from "vitest";
import {
  normalizeName,
  formatPrice,
  computeUnitPrice,
  savingsVsPublix,
} from "@/lib/price-utils";

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
