import type {
  AIProvider,
  ReceiptParseContext,
  ReceiptMetadata,
  ProductAttributes,
  CrossStoreMatch,
} from "./provider";
import type { ParsedLineItem } from "@/lib/normalize-product";

let _client: InstanceType<typeof import("@google/generative-ai").GoogleGenerativeAI> | null = null;
async function getClient() {
  if (!_client) {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  }
  return _client;
}

// ---- Prompts (shared with other providers) ----

const RECEIPT_IMAGE_PROMPT = `Extract all line items from this grocery receipt.
Return ONLY a JSON array with this structure (no markdown, no explanation):
[
  { "rawName": "PRODUCT NAME", "price": 1.99, "quantity": 1, "onSale": false, "saleType": null },
  ...
]
Rules:
- price is the shelf/regular price (not sale price)
- if there's a sale, include "salePrice" and set "onSale": true
- for BOGO items, set "saleType": "BOGO"
- for other sales, set "saleType": "SALE"
- skip tax, totals, subtotals, discounts — only include product line items
- rawName should match exactly what's printed on the receipt`;

function buildReceiptTextPrompt(text: string, context: ReceiptParseContext): string {
  const storeHint = context.store ? ` from ${context.store}` : "";
  const sourceHint = context.source === "email"
    ? "This is from an email receipt (monospace/fixed-width text)."
    : context.source === "paste"
    ? "This is copy-pasted from the store's website."
    : context.source === "devtools"
    ? "This is JSON from a browser network request."
    : "This is OCR text from a receipt image.";

  return `You are a grocery receipt parser. Extract all purchased items from this${storeHint} receipt.

${sourceHint}

Receipt content:
---
${text}
---

Return ONLY a JSON object (no markdown, no explanation) with this exact structure:
{
  "items": [
    {
      "rawName": "exact name as printed on receipt",
      "price": 5.79,
      "quantity": 1,
      "weight": null,
      "onSale": false,
      "salePrice": null,
      "saleType": null,
      "upc": null
    }
  ],
  "metadata": {
    "purchaseDate": "2026-03-15",
    "total": 45.67,
    "tax": 2.34,
    "storeLocation": "Store #1234",
    "store": "PUBLIX"
  }
}

Rules:
- price is ALWAYS the per-unit regular/shelf price
- For weighted items (e.g. "0.52 lb @ $8.99/lb = $4.67"), use the LINE TOTAL as price, and set weight to the weight in lb
- For multi-buy (e.g. "1 @ 2 FOR $5.00 = $2.50"), use the per-unit price as price
- BOGO: if saved amount equals one unit's regular price, set saleType to "BOGO"
- For other promotions/sales, set onSale to true and saleType to "SALE", with salePrice as the discounted price
- Skip tax lines, totals, subtotals, payment lines, savings summaries
- rawName should be exactly as printed (keep abbreviations)
- Set metadata fields to null if not found in the receipt
- store should be one of: "PUBLIX", "WALMART", "TARGET", or null`;
}

function buildNormalizePrompt(rawNames: string[], candidates?: string[]): string {
  let prompt = `You are a grocery product name normalizer. Given messy receipt abbreviations, return clean, human-readable product names.

Input names (one per line):
${rawNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}`;

  if (candidates?.length) {
    prompt += `\n\nKnown product names to match against (prefer these when they match):
${candidates.map((c) => `- ${c}`).join("\n")}`;
  }

  prompt += `\n\nReturn ONLY a JSON object mapping each input (by number) to the clean name:
{"1": "Clean Name One", "2": "Clean Name Two", ...}
No explanation, no markdown.`;

  return prompt;
}

function buildExtractAttributesPrompt(rawNames: string[]): string {
  return `You are a grocery product attribute extractor. For each product name, extract structured attributes.

Products:
${rawNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}

Return ONLY a JSON array (no markdown, no explanation):
[
  {
    "index": 1,
    "brand": "Kerrygold",
    "productType": "butter",
    "variety": "naturally softer grass-fed",
    "size": "8 oz",
    "unit": "oz",
    "unitSize": 8,
    "category": "dairy",
    "isStoreGeneric": false
  }
]

Rules:
- productType is the GENERIC product category (what IS it, ignoring brand). Examples: "butter", "deli turkey", "crackers", "whole milk", "greek yogurt"
- brand: the manufacturer or store brand name
- variety: distinguishing characteristics beyond the base product type
- size: normalized format with space ("8oz" -> "8 oz")
- isStoreGeneric: true for store brands — Publix, Great Value (Walmart), Good & Gather (Target), Market Pantry (Target), Member's Mark (Sam's Club), 365 (Whole Foods)
- Decode common receipt abbreviations: RSTD=Roasted, TURK=Turkey, GV=Great Value, GRK=Greek, YGT=Yogurt, STRW=Strawberry, CRCKRS=Crackers, ORIG=Original, etc.
- category should be one of: dairy, deli, bakery, meat, produce, frozen, snacks, beverages, pantry, household, other`;
}

function buildCrossStoreMatchPrompt(
  source: ProductAttributes,
  candidates: ProductAttributes[]
): string {
  return `You are a grocery product matcher. Determine which candidate products from other stores are the SAME product (or closest equivalent) as the source product.

Source product:
- Brand: ${source.brand ?? "unknown"}
- Type: ${source.productType}
- Variety: ${source.variety ?? "none"}
- Size: ${source.size ?? "unknown"}
- Store generic: ${source.isStoreGeneric ? "yes" : "no"}

Candidate products:
${candidates.map((c, i) => `${i + 1}. "${c.rawName}" — Brand: ${c.brand ?? "unknown"}, Type: ${c.productType}, Variety: ${c.variety ?? "none"}, Size: ${c.size ?? "unknown"}, Store generic: ${c.isStoreGeneric ? "yes" : "no"}`).join("\n")}

Return ONLY a JSON array of matches (no markdown, no explanation):
[
  {"index": 1, "confidence": 0.85, "matchReason": "same product type, similar size, both store generics"}
]

Rules:
- Only include candidates with confidence >= 0.5
- confidence is 0.0 to 1.0 — how likely these are the SAME underlying product
- Same type + same size + both store generics = 0.85+
- Same type + different size = 0.6-0.7
- Different type entirely = do not include
- Store generics from different stores are interchangeable
- If no candidates match, return an empty array []`;
}

// ---- Provider ----

export class GeminiProvider implements AIProvider {
  name = "gemini";

  async parseReceiptImage(imageBuffer: Buffer, mimeType: string) {
    const client = await getClient();
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: imageBuffer.toString("base64"),
        },
      },
      { text: RECEIPT_IMAGE_PROMPT },
    ]);

    const rawText = result.response.text();
    const items = parseJsonItems(rawText);
    return { items, rawText };
  }

  async normalizeProductName(rawName: string, candidates?: string[]) {
    const result = await this.normalizeProductNames([rawName], candidates);
    return result[rawName] ?? titleCase(rawName);
  }

  async normalizeProductNames(rawNames: string[], candidates?: string[]) {
    if (rawNames.length === 0) return {};

    const client = await getClient();
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(
      buildNormalizePrompt(rawNames, candidates)
    );

    const text = result.response.text();
    return parseNormalizeResponse(text, rawNames);
  }

  async parseReceiptText(text: string, context: ReceiptParseContext) {
    const client = await getClient();
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(
      buildReceiptTextPrompt(text, context)
    );

    const rawResponse = result.response.text();
    return parseReceiptTextResponse(rawResponse);
  }

  async extractProductAttributes(rawNames: string[]) {
    if (rawNames.length === 0) return [];

    const client = await getClient();
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(
      buildExtractAttributesPrompt(rawNames)
    );

    const text = result.response.text();
    return parseAttributesResponse(text, rawNames);
  }

  async matchProductsAcrossStores(
    sourceProduct: ProductAttributes,
    candidates: ProductAttributes[]
  ) {
    if (candidates.length === 0) return [];

    const client = await getClient();
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(
      buildCrossStoreMatchPrompt(sourceProduct, candidates)
    );

    const text = result.response.text();
    return parseCrossStoreMatchResponse(text, candidates);
  }
}

// ---- Response parsers ----

function parseJsonItems(text: string): ParsedLineItem[] {
  try {
    const clean = text.replace(/```(?:json)?/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i: Record<string, unknown>) => i.rawName && typeof i.price === "number"
    );
  } catch {
    return [];
  }
}

function parseReceiptTextResponse(text: string): {
  items: ParsedLineItem[];
  metadata: ReceiptMetadata;
} {
  try {
    const clean = text.replace(/```(?:json)?/g, "").trim();
    const parsed = JSON.parse(clean);

    const items: ParsedLineItem[] = [];
    if (Array.isArray(parsed.items)) {
      for (const i of parsed.items) {
        if (i.rawName && typeof i.price === "number" && i.price > 0) {
          items.push({
            rawName: String(i.rawName),
            price: Number(i.price),
            quantity: typeof i.quantity === "number" ? i.quantity : undefined,
            weight: typeof i.weight === "number" ? i.weight : undefined,
            onSale: !!i.onSale,
            salePrice: typeof i.salePrice === "number" ? i.salePrice : undefined,
            saleType: typeof i.saleType === "string" ? i.saleType : undefined,
            upc: typeof i.upc === "string" ? i.upc : undefined,
          });
        }
      }
    }

    const meta = parsed.metadata ?? {};
    const metadata: ReceiptMetadata = {
      purchaseDate: typeof meta.purchaseDate === "string" ? meta.purchaseDate : undefined,
      total: typeof meta.total === "number" ? meta.total : undefined,
      tax: typeof meta.tax === "number" ? meta.tax : undefined,
      storeLocation: typeof meta.storeLocation === "string" ? meta.storeLocation : undefined,
      store: typeof meta.store === "string" ? meta.store : undefined,
    };

    return { items, metadata };
  } catch {
    return { items: [], metadata: {} };
  }
}

function parseNormalizeResponse(
  text: string,
  rawNames: string[]
): Record<string, string> {
  try {
    const clean = text.replace(/```(?:json)?/g, "").trim();
    const parsed = JSON.parse(clean);
    const result: Record<string, string> = {};
    for (let i = 0; i < rawNames.length; i++) {
      const key = String(i + 1);
      if (parsed[key] && typeof parsed[key] === "string") {
        result[rawNames[i]] = parsed[key];
      } else {
        result[rawNames[i]] = titleCase(rawNames[i]);
      }
    }
    return result;
  } catch {
    const result: Record<string, string> = {};
    for (const name of rawNames) {
      result[name] = titleCase(name);
    }
    return result;
  }
}

function parseAttributesResponse(
  text: string,
  rawNames: string[]
): ProductAttributes[] {
  try {
    const clean = text.replace(/```(?:json)?/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) return rawNames.map(defaultAttributes);

    return rawNames.map((rawName, i) => {
      const entry = parsed.find(
        (e: Record<string, unknown>) => Number(e.index) === i + 1
      );
      if (!entry) return defaultAttributes(rawName);

      return {
        rawName,
        brand: typeof entry.brand === "string" ? entry.brand : undefined,
        productType: typeof entry.productType === "string" ? entry.productType : "unknown",
        variety: typeof entry.variety === "string" ? entry.variety : undefined,
        size: typeof entry.size === "string" ? entry.size : undefined,
        unit: typeof entry.unit === "string" ? entry.unit : undefined,
        unitSize: typeof entry.unitSize === "number" ? entry.unitSize : undefined,
        category: typeof entry.category === "string" ? entry.category : undefined,
        isStoreGeneric: !!entry.isStoreGeneric,
      };
    });
  } catch {
    return rawNames.map(defaultAttributes);
  }
}

function defaultAttributes(rawName: string): ProductAttributes {
  return { rawName, productType: "unknown" };
}

function parseCrossStoreMatchResponse(
  text: string,
  candidates: ProductAttributes[]
): CrossStoreMatch[] {
  try {
    const clean = text.replace(/```(?:json)?/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) return [];

    const results: CrossStoreMatch[] = [];
    for (const entry of parsed) {
      const idx = Number(entry.index) - 1;
      if (idx < 0 || idx >= candidates.length) continue;
      const confidence = Number(entry.confidence);
      if (isNaN(confidence) || confidence < 0.5) continue;

      results.push({
        candidateRawName: candidates[idx].rawName,
        confidence: Math.min(confidence, 1),
        matchReason: typeof entry.matchReason === "string" ? entry.matchReason : "",
      });
    }
    return results;
  } catch {
    return [];
  }
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
