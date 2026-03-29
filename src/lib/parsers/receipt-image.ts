/**
 * Parse a receipt from an image file.
 *
 * Uses the AI provider abstraction (Claude or OpenAI) if an API key is set.
 * Falls back to Tesseract OCR (free, local) otherwise.
 *
 * The image is processed server-side only — never sent to the client.
 */

import type { ParsedLineItem } from "@/lib/normalize-product";
import { getAIProvider } from "@/lib/ai/provider";

export interface ParsedImageReceipt {
  items: ParsedLineItem[];
  purchaseDate?: Date;
  total?: number;
  tax?: number;
  rawText: string;
  provider?: string; // which AI provider was used
}

// ---- Tesseract (free, default) ----

async function ocrWithTesseract(imageBuffer: Buffer): Promise<string> {
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng");
  try {
    const { data } = await worker.recognize(imageBuffer);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

// ---- Raw text → ParsedLineItem[] ----

function parseReceiptText(text: string): ParsedLineItem[] {
  const items: ParsedLineItem[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const pricePattern = /^(.+?)\s+\$?([\d,]+\.\d{2})\s*[BFTX]?\s*$/i;

  for (const line of lines) {
    if (/^(tax|total|subtotal|balance|change|payment|cash|credit|debit|savings)/i.test(line)) {
      continue;
    }

    const match = line.match(pricePattern);
    if (match) {
      const rawName = match[1].trim();
      const price = parseFloat(match[2].replace(",", ""));

      if (rawName.length >= 2 && price > 0 && price < 500) {
        items.push({ rawName, price });
      }
    }
  }

  return items;
}

// ---- Main export ----

export async function parseReceiptImage(
  imageBuffer: Buffer,
  mimeType = "image/jpeg"
): Promise<ParsedImageReceipt> {
  const aiProvider = getAIProvider();

  let rawText = "";
  let items: ParsedLineItem[] = [];
  let provider: string | undefined;

  if (aiProvider) {
    const result = await aiProvider.parseReceiptImage(imageBuffer, mimeType);
    rawText = result.rawText;
    items = result.items;
    provider = aiProvider.name;

    // Fall back to text parsing if structured parse returned nothing
    if (items.length === 0) {
      items = parseReceiptText(rawText);
    }
  } else {
    rawText = await ocrWithTesseract(imageBuffer);
    items = parseReceiptText(rawText);
    provider = "tesseract";
  }

  // Extract date and total from raw text
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

  return { items, purchaseDate, total, tax, rawText, provider };
}
