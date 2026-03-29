import type { AIProvider } from "./provider";
import type { ParsedLineItem } from "@/lib/normalize-product";

let _client: InstanceType<typeof import("@anthropic-ai/sdk").default> | null = null;
async function getClient() {
  if (!_client) {
    const Anthropic = await import("@anthropic-ai/sdk");
    _client = new Anthropic.default();
  }
  return _client;
}

const RECEIPT_PROMPT = `Extract all line items from this grocery receipt.
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

export class ClaudeProvider implements AIProvider {
  name = "claude";

  async parseReceiptImage(imageBuffer: Buffer, mimeType: string) {
    const client = await getClient();

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType as "image/jpeg" | "image/png" | "image/webp",
                data: imageBuffer.toString("base64"),
              },
            },
            { type: "text", text: RECEIPT_PROMPT },
          ],
        },
      ],
    });

    const rawText =
      response.content[0].type === "text" ? response.content[0].text : "";
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

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [
        { role: "user", content: buildNormalizePrompt(rawNames, candidates) },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    return parseNormalizeResponse(text, rawNames);
  }
}

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

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
