import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDevToolsJson } from "@/lib/parsers/receipt-devtools";

// Mock the AI provider so tests don't make real API calls
vi.mock("@/lib/ai/provider", () => ({
  getAIProvider: () => null,
}));

const fixturesDir = join(__dirname, "..", "fixtures");

describe("parseDevToolsJson — Publix format", () => {
  const json = readFileSync(join(fixturesDir, "publix-devtools.json"), "utf8");

  it("parses Publix API JSON into items", async () => {
    const result = await parseDevToolsJson(json);
    expect(result.items.length).toBe(5);
  });

  it("detects Publix format", async () => {
    const result = await parseDevToolsJson(json);
    expect(result.detectedFormat).toBe("publix");
  });

  it("extracts UPCs", async () => {
    const result = await parseDevToolsJson(json);
    const butter = result.items.find((i) =>
      i.rawName.toLowerCase().includes("kerrygold") ||
      i.rawName.toLowerCase().includes("butter")
    );
    expect(butter).toBeDefined();
    expect(butter?.upc).toBe("024300040108");
  });

  it("extracts prices", async () => {
    const result = await parseDevToolsJson(json);
    const milk = result.items.find((i) =>
      i.rawName.toLowerCase().includes("milk")
    );
    expect(milk?.price).toBe(4.69);
  });

  it("extracts purchase date", async () => {
    const result = await parseDevToolsJson(json);
    expect(result.purchaseDate).toBeDefined();
    if (result.purchaseDate) {
      expect(result.purchaseDate.getFullYear()).toBe(2026);
    }
  });

  it("extracts total", async () => {
    const result = await parseDevToolsJson(json);
    expect(result.total).toBe(28.94);
  });
});

describe("parseDevToolsJson — Walmart format", () => {
  const json = readFileSync(join(fixturesDir, "walmart-devtools.json"), "utf8");

  it("parses Walmart API JSON into items", async () => {
    const result = await parseDevToolsJson(json);
    expect(result.items.length).toBe(4);
  });

  it("detects Walmart format", async () => {
    const result = await parseDevToolsJson(json);
    expect(result.detectedFormat).toBe("walmart");
  });

  it("extracts product names", async () => {
    const result = await parseDevToolsJson(json);
    const names = result.items.map((i) => i.rawName.toLowerCase());
    expect(names.some((n) => n.includes("milk"))).toBe(true);
    expect(names.some((n) => n.includes("turkey"))).toBe(true);
  });

  it("extracts prices from charge amounts", async () => {
    const result = await parseDevToolsJson(json);
    const milk = result.items.find((i) =>
      i.rawName.toLowerCase().includes("milk")
    );
    expect(milk?.price).toBe(3.48);
  });

  it("extracts UPCs", async () => {
    const result = await parseDevToolsJson(json);
    const ritz = result.items.find((i) =>
      i.rawName.toLowerCase().includes("ritz")
    );
    expect(ritz?.upc).toBe("044000032159");
  });
});

describe("parseDevToolsJson — error handling", () => {
  it("throws on invalid JSON", async () => {
    await expect(parseDevToolsJson("not json")).rejects.toThrow("Invalid JSON");
  });

  it("throws when no items found", async () => {
    await expect(parseDevToolsJson('{"empty": true}')).rejects.toThrow(
      "Could not parse any line items"
    );
  });
});
