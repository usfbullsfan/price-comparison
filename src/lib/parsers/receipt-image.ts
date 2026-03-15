/**
 * Parse a receipt from an image file using Tesseract OCR (free, local).
 *
 * If ANTHROPIC_API_KEY is set, we'll use Claude Vision instead for
 * significantly better accuracy on formatted receipts.
 *
 * The image is processed server-side only — never sent to the client.
 */

import type { ParsedLineItem } from "@/lib/normalize-product";

export interface ParsedImageReceipt {
  items: ParsedLineItem[];
  purchaseDate?: Date;
  total?: number;
  tax?: number;
  rawText: string;
}

// ---- Tesseract (free, default) ----

async function ocrWithTesseract(imageBuffer: Buffer): Promise<string> {
  // Dynamically import to avoid bundling on the client
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng");
  const { data } = await worker.recognize(imageBuffer);
  await worker.terminate();
  return data.text;
}

// ---- Claude Vision (optional, requires ANTHROPIC_API_KEY) ----

async function ocrWithClaude(imageBuffer: Buffer, mimeType: string): Promise<string> {
  const Anthropic = await import("@anthropic-ai/sdk");
  const client = new Anthropic.default();

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 2048,
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
          {
            type: "text",
            text: `Extract all line items from this grocery receipt.
Return ONLY a JSON array with this structure (no markdown, no explanation):
[
  { "rawName": "PRODUCT NAME", "price": 1.99, "quantity": 1, "onSale": false, "upc": "optional" },
  ...
]
Rules:
- price is the shelf/regular price (not sale price)
- if there's a sale, include "salePrice" and set "onSale": true
- skip tax, totals, subtotals, discounts — only include product line items
- rawName should match exactly what's printed on the receipt`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return text;
}

// ---- Raw text → ParsedLineItem[] ----

function parseReceiptText(text: string): ParsedLineItem[] {
  const items: ParsedLineItem[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Pattern: "PRODUCT NAME    $X.XX" or "PRODUCT NAME X.XX"
  const pricePattern = /^(.+?)\s+\$?([\d,]+\.\d{2})\s*[BFTX]?\s*$/i;
  // Pattern for sale: line starting with "S " or "*" often indicates sale
  const saleIndicator = /^[*S]\s+/;

  let lastItem: ParsedLineItem | null = null;

  for (const line of lines) {
    // Skip totals / non-items
    if (/^(tax|total|subtotal|balance|change|payment|cash|credit|debit|savings)/i.test(line)) {
      continue;
    }

    const match = line.match(pricePattern);
    if (match) {
      const rawName = match[1].replace(saleIndicator, "").trim();
      const price = parseFloat(match[2].replace(",", ""));

      if (rawName.length >= 2 && price > 0 && price < 500) {
        lastItem = { rawName, price };
        items.push(lastItem);
      }
    }
  }

  return items;
}

function parseClaudeJson(text: string): ParsedLineItem[] {
  try {
    // Strip any markdown code fences
    const clean = text.replace(/```(?:json)?/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((i) => i.rawName && typeof i.price === "number");
  } catch {
    return [];
  }
}

// ---- Main export ----

export async function parseReceiptImage(
  imageBuffer: Buffer,
  mimeType = "image/jpeg"
): Promise<ParsedImageReceipt> {
  const useClaudeVision =
    !!process.env.ANTHROPIC_API_KEY &&
    process.env.ANTHROPIC_API_KEY.startsWith("sk-ant-");

  let rawText = "";
  let items: ParsedLineItem[] = [];

  if (useClaudeVision) {
    rawText = await ocrWithClaude(imageBuffer, mimeType);
    items = parseClaudeJson(rawText);
    // Fall back to text parsing if JSON parse failed
    if (items.length === 0) {
      items = parseReceiptText(rawText);
    }
  } else {
    rawText = await ocrWithTesseract(imageBuffer);
    items = parseReceiptText(rawText);
  }

  // Try to extract date and total from raw text
  let purchaseDate: Date | undefined;
  let total: number | undefined;
  let tax: number | undefined;

  const dateMatch = rawText.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  if (dateMatch) {
    const d = new Date(dateMatch[1]);
    if (!isNaN(d.getTime())) purchaseDate = d;
  }

  const totalMatch = rawText.match(/total\s+\$?([\d,]+\.\d{2})/i);
  if (totalMatch) total = parseFloat(totalMatch[1].replace(",", ""));

  const taxMatch = rawText.match(/tax\s+\$?([\d,]+\.\d{2})/i);
  if (taxMatch) tax = parseFloat(taxMatch[1].replace(",", ""));

  return { items, purchaseDate, total, tax, rawText };
}
