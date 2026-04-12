import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parsePublixEmailReceipt,
  parsePublixPreText,
  detectStore,
} from "@/lib/parsers/receipt-email";

const fixturesDir = join(__dirname, "..", "fixtures");

describe("parsePublixPreText", () => {
  it("parses monospace receipt text into items", () => {
    const text = `
KRGLD BUTTER TUB              5.79   F
PUBLIX DELI RSTD TURK
  0.52 lb @     8.99/ lb        4.67   F
RITZ ORIG CRCKRS              6.49   F
   Promotion                 -1.50   F
   You Saved        1.50
PUBLIX WHOLE MILK             4.69   F
CHOBANI GRK YGT STRW         1.49   F

                  Subtotal       23.12
                  Sales Tax       1.62
                  Grand Total    24.74

      03/15/2026  10:46
`;

    const result = parsePublixPreText(text);
    expect(result.items.length).toBe(5);
  });

  it("extracts weighted items correctly", () => {
    const text = `
PUBLIX DELI RSTD TURK
  0.52 lb @     8.99/ lb        4.67   F
`;
    const result = parsePublixPreText(text);
    expect(result.items.length).toBe(1);
    expect(result.items[0].rawName).toBe("PUBLIX DELI RSTD TURK");
    expect(result.items[0].price).toBe(4.67);
    expect(result.items[0].weight).toBe(0.52);
  });

  it("handles promotion lines", () => {
    const text = `
RITZ ORIG CRCKRS              6.49   F
   Promotion                 -1.50   F
`;
    const result = parsePublixPreText(text);
    expect(result.items.length).toBe(1);
    expect(result.items[0].rawName).toBe("RITZ ORIG CRCKRS");
    expect(result.items[0].price).toBe(6.49);
    expect(result.items[0].onSale).toBe(true);
    expect(result.items[0].salePrice).toBe(4.99);
  });

  it("extracts total and tax", () => {
    const text = `
ITEM ONE                      5.00   F

                  Sales Tax       0.35
                  Grand Total     5.35

      03/15/2026  10:46
`;
    const result = parsePublixPreText(text);
    expect(result.total).toBe(5.35);
    expect(result.tax).toBe(0.35);
  });

  it("extracts purchase date", () => {
    const text = `
ITEM ONE                      5.00   F

      03/15/2026  10:46
`;
    const result = parsePublixPreText(text);
    expect(result.purchaseDate).toBeDefined();
    if (result.purchaseDate) {
      expect(result.purchaseDate.getFullYear()).toBe(2026);
    }
  });

  it("handles multi-buy items", () => {
    const text = `
CHOBANI GRK YGT STRW
  1 @   2 FOR      5.00         2.50   F
`;
    const result = parsePublixPreText(text);
    expect(result.items.length).toBe(1);
    expect(result.items[0].price).toBe(2.50);
    expect(result.items[0].quantity).toBe(1);
  });
});

describe("parsePublixEmailReceipt", () => {
  const html = readFileSync(join(fixturesDir, "publix-email.html"), "utf8");

  it("parses a full Publix email receipt", () => {
    const result = parsePublixEmailReceipt(html);
    expect(result.store).toBe("PUBLIX");
    expect(result.items.length).toBeGreaterThanOrEqual(4);
  });

  it("extracts total from email", () => {
    const result = parsePublixEmailReceipt(html);
    expect(result.total).toBe(24.74);
  });

  it("extracts tax from email", () => {
    const result = parsePublixEmailReceipt(html);
    expect(result.tax).toBe(1.62);
  });

  it("detects weighted items in email", () => {
    const result = parsePublixEmailReceipt(html);
    const turkey = result.items.find((i) =>
      i.rawName.includes("TURK") || i.rawName.includes("DELI")
    );
    if (turkey) {
      expect(turkey.weight).toBe(0.52);
    }
  });
});

describe("detectStore", () => {
  it("detects Publix from sender", () => {
    expect(
      detectStore({ from: "receipts@publix.com", to: [], subject: "Your receipt", })
    ).toBe("PUBLIX");
  });

  it("detects Publix from subject", () => {
    expect(
      detectStore({ from: "noreply@example.com", to: [], subject: "Your Publix receipt", })
    ).toBe("PUBLIX");
  });

  it("returns null for unknown store", () => {
    expect(
      detectStore({ from: "noreply@example.com", to: [], subject: "Your receipt", })
    ).toBeNull();
  });
});
