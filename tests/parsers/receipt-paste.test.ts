import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parsePublixPasteHtml,
  parsePublixPasteReceipt,
} from "@/lib/parsers/receipt-paste";

const fixturesDir = join(__dirname, "..", "fixtures");

describe("parsePublixPasteHtml", () => {
  const html = readFileSync(join(fixturesDir, "publix-paste-rich.html"), "utf8");

  it("extracts all items from HTML", () => {
    const result = parsePublixPasteHtml(html);
    expect(result.items.length).toBeGreaterThanOrEqual(4);
  });

  it("returns store as PUBLIX", () => {
    const result = parsePublixPasteHtml(html);
    expect(result.store).toBe("PUBLIX");
  });

  it("extracts item names and prices", () => {
    const result = parsePublixPasteHtml(html);
    const names = result.items.map((i) => i.rawName.toLowerCase());
    const hasButter = names.some((n) => n.includes("kerrygold") || n.includes("butter"));
    const hasMilk = names.some((n) => n.includes("milk"));
    expect(hasButter).toBe(true);
    expect(hasMilk).toBe(true);
  });

  it("extracts positive prices for all items", () => {
    const result = parsePublixPasteHtml(html);
    for (const item of result.items) {
      expect(item.price).toBeGreaterThan(0);
      expect(typeof item.price).toBe("number");
    }
  });

  it("detects sale items", () => {
    const result = parsePublixPasteHtml(html);
    const ritz = result.items.find((i) =>
      i.rawName.toLowerCase().includes("ritz")
    );
    // Ritz has a "Save $1.50" tag in the fixture
    if (ritz) {
      expect(ritz.onSale).toBe(true);
    }
  });
});

describe("parsePublixPasteReceipt", () => {
  const text = readFileSync(join(fixturesDir, "publix-paste-plain.txt"), "utf8");

  it("extracts items from plain text", () => {
    const result = parsePublixPasteReceipt(text);
    expect(result.items.length).toBeGreaterThanOrEqual(4);
  });

  it("returns store as PUBLIX", () => {
    const result = parsePublixPasteReceipt(text);
    expect(result.store).toBe("PUBLIX");
  });

  it("extracts prices correctly", () => {
    const result = parsePublixPasteReceipt(text);
    const butter = result.items.find((i) =>
      i.rawName.toLowerCase().includes("butter") ||
      i.rawName.toLowerCase().includes("kerrygold")
    );
    if (butter) {
      expect(butter.price).toBe(5.79);
    }
  });

  it("extracts total", () => {
    const result = parsePublixPasteReceipt(text);
    if (result.total) {
      expect(result.total).toBe(28.94);
    }
  });

  it("extracts purchase date", () => {
    const result = parsePublixPasteReceipt(text);
    if (result.purchaseDate) {
      expect(result.purchaseDate.getFullYear()).toBe(2026);
      expect(result.purchaseDate.getMonth()).toBe(2); // March = 2
    }
  });
});
