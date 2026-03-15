/**
 * Parse a Publix receipt from email HTML.
 *
 * Publix sends structured HTML receipts — we extract the line items
 * without needing any AI or OCR, keeping this 100% free.
 *
 * The structure may evolve; add alternative selectors as needed.
 */

import * as cheerio from "cheerio";
import type { ParsedLineItem } from "@/lib/normalize-product";

export interface ParsedEmailReceipt {
  store: "PUBLIX";
  purchaseDate?: Date;
  total?: number;
  tax?: number;
  items: ParsedLineItem[];
  rawHtml: string;
}

export function parsePublixEmailReceipt(html: string): ParsedEmailReceipt {
  const $ = cheerio.load(html);
  const items: ParsedLineItem[] = [];

  let purchaseDate: Date | undefined;
  let total: number | undefined;
  let tax: number | undefined;

  // --- Date extraction ---
  // Try common patterns like "Purchase Date: 01/15/2025" or "Date: January 15, 2025"
  const bodyText = $("body").text();
  const datePatterns = [
    /(?:purchase\s*date|transaction\s*date|date)[:\s]+(\w+ \d{1,2},?\s*\d{4})/i,
    /(?:purchase\s*date|transaction\s*date|date)[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ];
  for (const pattern of datePatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      const parsed = new Date(match[1]);
      if (!isNaN(parsed.getTime())) {
        purchaseDate = parsed;
        break;
      }
    }
  }

  // --- Total extraction ---
  const totalMatch = bodyText.match(/(?:order\s*total|total)[:\s]+\$?([\d,]+\.\d{2})/i);
  if (totalMatch) total = parseFloat(totalMatch[1].replace(",", ""));

  const taxMatch = bodyText.match(/(?:tax)[:\s]+\$?([\d,]+\.\d{2})/i);
  if (taxMatch) tax = parseFloat(taxMatch[1].replace(",", ""));

  // --- Line items ---
  // Strategy 1: Look for table rows with price patterns
  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;

    const lastCell = $(cells[cells.length - 1]).text().trim();
    const priceMatch = lastCell.match(/^\$?([\d,]+\.\d{2})$/);
    if (!priceMatch) return;

    const price = parseFloat(priceMatch[1].replace(",", ""));
    if (price <= 0 || price > 1000) return; // sanity check

    // Product name is usually in the first or second cell
    const rawName = $(cells[0]).text().trim() || $(cells[1]).text().trim();
    if (!rawName || rawName.length < 2) return;

    // Skip totals / tax rows
    if (/tax|total|subtotal|savings|discount|fee/i.test(rawName)) return;

    items.push({ rawName, price });
  });

  // Strategy 2: Scan for price-looking spans/divs if no table rows found
  if (items.length === 0) {
    const priceRegex = /\$([\d,]+\.\d{2})/g;
    // Look for elements that contain a product name followed by a price
    $("[class*='item'], [class*='product'], [class*='line']").each((_, el) => {
      const text = $(el).text().trim();
      const match = text.match(/^(.+?)\s+\$([\d,]+\.\d{2})$/);
      if (match) {
        const rawName = match[1].trim();
        const price = parseFloat(match[2].replace(",", ""));
        if (rawName && price > 0) {
          items.push({ rawName, price });
        }
      }
    });
  }

  return { store: "PUBLIX", purchaseDate, total, tax, items, rawHtml: html };
}

/**
 * Parse a Resend inbound email webhook payload.
 * Resend sends: { from, to, subject, html, text, ... }
 */
export interface ResendInboundPayload {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
}

export function detectStore(payload: ResendInboundPayload): "PUBLIX" | null {
  const from = payload.from.toLowerCase();
  const subject = payload.subject.toLowerCase();

  if (from.includes("publix") || subject.includes("publix")) return "PUBLIX";
  return null;
}
