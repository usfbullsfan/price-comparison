import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Mock the AI provider module before importing the parser
vi.mock("@/lib/ai/provider", () => ({
  getAIProvider: vi.fn(),
}));

import { parseReceiptPasteAI } from "@/lib/parsers/receipt-paste-ai";
import { getAIProvider } from "@/lib/ai/provider";

const fixturesDir = join(__dirname, "..", "fixtures");
const plainText = readFileSync(join(fixturesDir, "publix-paste-plain.txt"), "utf8");
const richHtml = readFileSync(join(fixturesDir, "publix-paste-rich.html"), "utf8");

const mockedGetAIProvider = vi.mocked(getAIProvider);

describe("parseReceiptPasteAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when AI provider is not available", () => {
    beforeEach(() => {
      mockedGetAIProvider.mockReturnValue(null);
    });

    it("falls back to regex parser for plain text", async () => {
      const result = await parseReceiptPasteAI(plainText, undefined);
      expect(result.parseMethod).toBe("regex");
      expect(result.items.length).toBeGreaterThanOrEqual(4);
      expect(result.store).toBe("PUBLIX");
    });

    it("falls back to regex parser for HTML", async () => {
      const result = await parseReceiptPasteAI(plainText, richHtml);
      expect(result.parseMethod).toBe("regex");
      expect(result.items.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("when AI provider returns valid results", () => {
    beforeEach(() => {
      mockedGetAIProvider.mockReturnValue({
        name: "mock",
        parseReceiptImage: vi.fn(),
        normalizeProductName: vi.fn(),
        normalizeProductNames: vi.fn(),
        extractProductAttributes: vi.fn(),
        matchProductsAcrossStores: vi.fn(),
        parseReceiptText: vi.fn().mockResolvedValue({
          items: [
            { rawName: "Kerrygold Butter", price: 5.79 },
            { rawName: "Publix Whole Milk", price: 4.69 },
            { rawName: "Ritz Crackers", price: 6.49, onSale: true, salePrice: 4.99 },
          ],
          metadata: {
            purchaseDate: "2026-03-15",
            total: 16.97,
            store: "PUBLIX",
            storeLocation: "Store #1234",
          },
        }),
      });
    });

    it("uses AI results", async () => {
      const result = await parseReceiptPasteAI(plainText, undefined);
      expect(result.parseMethod).toBe("ai");
      expect(result.items.length).toBe(3);
    });

    it("extracts metadata from AI response", async () => {
      const result = await parseReceiptPasteAI(plainText, undefined);
      expect(result.purchaseDate).toBeDefined();
      expect(result.total).toBe(16.97);
      expect(result.storeLocation).toBe("Store #1234");
    });
  });

  describe("when AI provider returns empty items", () => {
    beforeEach(() => {
      mockedGetAIProvider.mockReturnValue({
        name: "mock",
        parseReceiptImage: vi.fn(),
        normalizeProductName: vi.fn(),
        normalizeProductNames: vi.fn(),
        extractProductAttributes: vi.fn(),
        matchProductsAcrossStores: vi.fn(),
        parseReceiptText: vi.fn().mockResolvedValue({
          items: [],
          metadata: {},
        }),
      });
    });

    it("falls back to regex parser", async () => {
      const result = await parseReceiptPasteAI(plainText, undefined);
      expect(result.parseMethod).toBe("regex");
      expect(result.items.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("when AI provider returns invalid prices", () => {
    beforeEach(() => {
      mockedGetAIProvider.mockReturnValue({
        name: "mock",
        parseReceiptImage: vi.fn(),
        normalizeProductName: vi.fn(),
        normalizeProductNames: vi.fn(),
        extractProductAttributes: vi.fn(),
        matchProductsAcrossStores: vi.fn(),
        parseReceiptText: vi.fn().mockResolvedValue({
          items: [
            { rawName: "Expensive Item", price: 999.99 }, // over $200 limit
          ],
          metadata: {},
        }),
      });
    });

    it("falls back to regex parser", async () => {
      const result = await parseReceiptPasteAI(plainText, undefined);
      expect(result.parseMethod).toBe("regex");
    });
  });

  describe("when AI provider throws an error", () => {
    beforeEach(() => {
      mockedGetAIProvider.mockReturnValue({
        name: "mock",
        parseReceiptImage: vi.fn(),
        normalizeProductName: vi.fn(),
        normalizeProductNames: vi.fn(),
        extractProductAttributes: vi.fn(),
        matchProductsAcrossStores: vi.fn(),
        parseReceiptText: vi.fn().mockRejectedValue(new Error("API rate limit")),
      });
    });

    it("falls back to regex parser", async () => {
      const result = await parseReceiptPasteAI(plainText, undefined);
      expect(result.parseMethod).toBe("regex");
      expect(result.items.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("validation: item sum vs total mismatch", () => {
    beforeEach(() => {
      mockedGetAIProvider.mockReturnValue({
        name: "mock",
        parseReceiptImage: vi.fn(),
        normalizeProductName: vi.fn(),
        normalizeProductNames: vi.fn(),
        extractProductAttributes: vi.fn(),
        matchProductsAcrossStores: vi.fn(),
        parseReceiptText: vi.fn().mockResolvedValue({
          items: [
            { rawName: "Item One", price: 1.00 },
          ],
          metadata: {
            total: 50.00, // $1 sum vs $50 total = way off
          },
        }),
      });
    });

    it("falls back to regex when items sum is too far from total", async () => {
      const result = await parseReceiptPasteAI(plainText, undefined);
      expect(result.parseMethod).toBe("regex");
    });
  });
});
