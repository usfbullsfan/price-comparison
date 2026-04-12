/**
 * Parse a Publix receipt from email HTML.
 *
 * Publix sends HTML receipts with the receipt body inside a <pre> tag
 * as fixed-width monospace text. We extract and parse that text
 * line-by-line using a state machine to handle multi-line items
 * (weighted, multi-buy) and promotions.
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

/**
 * Parse a Publix receipt from the monospace text found in a <pre> tag.
 * This is the core parsing logic shared between email HTML and raw text.
 */
export function parsePublixPreText(text: string): {
  items: ParsedLineItem[];
  purchaseDate?: Date;
  total?: number;
  tax?: number;
} {
  const lines = text.split("\n");
  const items: ParsedLineItem[] = [];

  let purchaseDate: Date | undefined;
  let total: number | undefined;
  let tax: number | undefined;
  let pendingName: string | null = null;
  let lastItem: ParsedLineItem | null = null;
  let reachedSummary = false;

  // Date pattern: 03/15/2026 10:46 in the footer
  const datePattern = /(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}:\d{2})/;

  // Simple item: "PRODUCT NAME              5.79   F"
  // Price is right-aligned, separated by 2+ spaces, optionally followed by tax flag
  const simpleItemPattern = /^(\S.+?)\s{2,}(\d+\.\d{2})\s+[A-Z]?\s*$/;

  // Weighted item detail: "  1.14 lb @     3.49/ lb        3.98   F"
  const weightedPattern = /^\s+([\d.]+)\s*lb\s*@\s*([\d.]+)\s*\/\s*lb\s+([\d.]+)\s+[A-Z]?\s*$/;

  // Multi-buy detail: "  1 @   2 FOR      5.00         2.50   F"
  const multiBuyPattern = /^\s+(\d+)\s*@\s*(\d+)\s+FOR\s+([\d.]+)\s+([\d.]+)\s+[A-Z]?\s*$/i;

  // Promotion: "   Promotion                 -7.75   F"
  const promotionPattern = /^\s+Promotion\s+(-?[\d.]+)\s+[A-Z]?\s*$/i;

  // You Saved: "   You Saved        1.90"
  const youSavedPattern = /^\s+You Saved\s+([\d.]+)\s*$/i;

  // Summary lines
  const orderTotalPattern = /^\s*(?:Order\s+)?Total\s+([\d.]+)\s*$/i;
  const grandTotalPattern = /^\s*Grand\s+Total\s+([\d.]+)\s*$/i;
  const salesTaxPattern = /^\s*Sales\s+Tax\s+([\d.]+)\s*$/i;

  for (const line of lines) {
    if (!line.trim()) continue;

    // Check for date in footer
    const dateMatch = line.match(datePattern);
    if (dateMatch && !purchaseDate) {
      const parsed = new Date(dateMatch[1] + " " + dateMatch[2]);
      if (!isNaN(parsed.getTime())) {
        purchaseDate = parsed;
      }
    }

    // Stop collecting items once we hit the summary section
    if (/^\s*(Order\s+Total|Savings\s+Summary|Credit\s+Payment)/i.test(line)) {
      reachedSummary = true;
    }

    // Extract totals from summary
    const grandTotalMatch = line.match(grandTotalPattern);
    if (grandTotalMatch) {
      total = parseFloat(grandTotalMatch[1]);
      continue;
    }
    const orderTotalMatch = line.match(orderTotalPattern);
    if (orderTotalMatch && !total) {
      total = parseFloat(orderTotalMatch[1]);
      continue;
    }
    const taxMatch = line.match(salesTaxPattern);
    if (taxMatch) {
      tax = parseFloat(taxMatch[1]);
      continue;
    }

    if (reachedSummary) continue;

    // Try promotion line (applies to previous item)
    const promoMatch = line.match(promotionPattern);
    if (promoMatch && lastItem) {
      const promoAmount = parseFloat(promoMatch[1]);
      lastItem.onSale = true;
      // promoAmount is negative (e.g. -7.75), so price + promoAmount = sale price
      lastItem.salePrice = Math.max(0, lastItem.price + promoAmount);
      continue;
    }

    // Try "You Saved" line
    const savedMatch = line.match(youSavedPattern);
    if (savedMatch && lastItem) {
      lastItem.onSale = true;
      continue;
    }

    // Try weighted item detail (follows a pending name)
    const weightMatch = line.match(weightedPattern);
    if (weightMatch) {
      const weight = parseFloat(weightMatch[1]);
      const lineTotal = parseFloat(weightMatch[3]);
      const name = pendingName ?? "Unknown Item";
      const item: ParsedLineItem = {
        rawName: name,
        price: lineTotal,
        weight,
      };
      items.push(item);
      lastItem = item;
      pendingName = null;
      continue;
    }

    // Try multi-buy detail (follows a pending name)
    const multiBuyMatch = line.match(multiBuyPattern);
    if (multiBuyMatch) {
      const qty = parseInt(multiBuyMatch[1], 10);
      const lineTotal = parseFloat(multiBuyMatch[4]);
      const name = pendingName ?? "Unknown Item";
      const item: ParsedLineItem = {
        rawName: name,
        price: lineTotal,
        quantity: qty,
      };
      items.push(item);
      lastItem = item;
      pendingName = null;
      continue;
    }

    // Try simple item (name + price on same line)
    const simpleMatch = line.match(simpleItemPattern);
    if (simpleMatch) {
      const rawName = simpleMatch[1].trim();
      const price = parseFloat(simpleMatch[2]);

      // Skip summary-like lines that might match
      if (/^(sub\s*total|tax|total|savings|change|payment)/i.test(rawName)) continue;

      // Flush any pending name (it was a name-only line that wasn't followed by weight/multibuy)
      pendingName = null;

      const item: ParsedLineItem = { rawName, price };
      items.push(item);
      lastItem = item;
      continue;
    }

    // Name-only line: has text content but no price — next line will have the details
    const trimmed = line.trim();
    if (trimmed.length >= 2 && !/^\d/.test(trimmed) && !/^(Promotion|You Saved|Savings|Receipt|Customer|PRESTO|Trace|Reference|Acct|Purchase|Amount|Auth|CREDIT|Entry|Mode|Issuer|Your cashier|Join|Apply|We're|Publix Super)/i.test(trimmed)) {
      pendingName = trimmed;
      continue;
    }
  }

  return { items, purchaseDate, total, tax };
}

export function parsePublixEmailReceipt(html: string): ParsedEmailReceipt {
  const $ = cheerio.load(html);
  const items: ParsedLineItem[] = [];

  let purchaseDate: Date | undefined;
  let total: number | undefined;
  let tax: number | undefined;

  // --- Strategy 1: Extract <pre> tag content (actual Publix email format) ---
  const preText = $("pre").text();
  if (preText && preText.length > 50) {
    const parsed = parsePublixPreText(preText);
    if (parsed.items.length > 0) {
      return {
        store: "PUBLIX",
        purchaseDate: parsed.purchaseDate,
        total: parsed.total,
        tax: parsed.tax,
        items: parsed.items,
        rawHtml: html,
      };
    }
  }

  // --- Strategy 2 (fallback): Look for table rows with price patterns ---
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

  const totalMatch = bodyText.match(/(?:order\s*total|total)[:\s]+\$?([\d,]+\.\d{2})/i);
  if (totalMatch) total = parseFloat(totalMatch[1].replace(",", ""));

  const taxMatch = bodyText.match(/(?:tax)[:\s]+\$?([\d,]+\.\d{2})/i);
  if (taxMatch) tax = parseFloat(taxMatch[1].replace(",", ""));

  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;

    const lastCell = $(cells[cells.length - 1]).text().trim();
    const priceMatch = lastCell.match(/^\$?([\d,]+\.\d{2})$/);
    if (!priceMatch) return;

    const price = parseFloat(priceMatch[1].replace(",", ""));
    if (price <= 0 || price > 1000) return;

    const rawName = $(cells[0]).text().trim() || $(cells[1]).text().trim();
    if (!rawName || rawName.length < 2) return;

    if (/tax|total|subtotal|savings|discount|fee/i.test(rawName)) return;

    items.push({ rawName, price });
  });

  // Strategy 3: Scan for price-looking spans/divs if no table rows found
  if (items.length === 0) {
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

export function detectStore(payload: ResendInboundPayload): "PUBLIX" | "WALMART" | "TARGET" | null {
  const from = payload.from.toLowerCase();
  const subject = payload.subject.toLowerCase();

  if (from.includes("publix") || subject.includes("publix")) return "PUBLIX";
  if (from.includes("walmart") || subject.includes("walmart")) return "WALMART";
  if (from.includes("target") || subject.includes("target")) return "TARGET";
  return null;
}
