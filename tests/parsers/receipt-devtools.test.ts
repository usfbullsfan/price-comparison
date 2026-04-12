import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDevToolsJson } from "@/lib/parsers/receipt-devtools";

const fixturesDir = join(__dirname, "..", "fixtures");

describe("parseDevToolsJson — Publix format", () => {
  const json = readFileSync(join(fixturesDir, "publix-devtools.json"), "utf8");

  it("parses Publix API JSON into items", () => {
    const result = parseDevToolsJson(json);
    expect(result.items.length).toBe(5);
  });

  it("detects Publix format", () => {
    const result = parseDevToolsJson(json);
    expect(result.detectedFormat).toBe("publix");
  });

  it("extracts UPCs", () => {
    const result = parseDevToolsJson(json);
    const butter = result.items.find((i) =>
      i.rawName.toLowerCase().includes("kerrygold") ||
      i.rawName.toLowerCase().includes("butter")
    );
    expect(butter).toBeDefined();
    expect(butter?.upc).toBe("024300040108");
  });

  it("extracts prices", () => {
    const result = parseDevToolsJson(json);
    const milk = result.items.find((i) =>
      i.rawName.toLowerCase().includes("milk")
    );
    expect(milk?.price).toBe(4.69);
  });

  it("extracts purchase date", () => {
    const result = parseDevToolsJson(json);
    expect(result.purchaseDate).toBeDefined();
    if (result.purchaseDate) {
      expect(result.purchaseDate.getFullYear()).toBe(2026);
    }
  });

  it("extracts total", () => {
    const result = parseDevToolsJson(json);
    expect(result.total).toBe(28.94);
  });
});

describe("parseDevToolsJson — Walmart format", () => {
  const json = readFileSync(join(fixturesDir, "walmart-devtools.json"), "utf8");

  it("parses Walmart API JSON into items", () => {
    const result = parseDevToolsJson(json);
    expect(result.items.length).toBe(4);
  });

  it("detects Walmart format", () => {
    const result = parseDevToolsJson(json);
    expect(result.detectedFormat).toBe("walmart");
  });

  it("extracts product names", () => {
    const result = parseDevToolsJson(json);
    const names = result.items.map((i) => i.rawName.toLowerCase());
    expect(names.some((n) => n.includes("milk"))).toBe(true);
    expect(names.some((n) => n.includes("turkey"))).toBe(true);
  });

  it("extracts prices from charge amounts", () => {
    const result = parseDevToolsJson(json);
    const milk = result.items.find((i) =>
      i.rawName.toLowerCase().includes("milk")
    );
    expect(milk?.price).toBe(3.48);
  });

  it("extracts UPCs", () => {
    const result = parseDevToolsJson(json);
    const ritz = result.items.find((i) =>
      i.rawName.toLowerCase().includes("ritz")
    );
    expect(ritz?.upc).toBe("044000032159");
  });
});

describe("parseDevToolsJson — error handling", () => {
  it("throws on invalid JSON", () => {
    expect(() => parseDevToolsJson("not json")).toThrow("Invalid JSON");
  });

  it("throws when no items found", () => {
    expect(() => parseDevToolsJson('{"empty": true}')).toThrow(
      "Could not parse any line items"
    );
  });
});
