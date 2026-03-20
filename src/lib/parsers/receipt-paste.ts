/**
 * Parse receipt data from Publix website copy-paste text.
 *
 * When a user does CMD+A on the Publix purchase-details page and pastes,
 * the text contains structured blocks like:
 *
 *   * Lamb Weston Tots, Super Crispy
 *   28 oz (1.75 lb) 793 g
 *   Qty: 1
 *   $5.79
 *   * Kerrygold Butter Naturally Softer Grass-fed Pure Irish Butter Tub
 *   8 oz
 *   Qty: 2
 *   $7.75
 *   You saved $7.75
 *
 * Items may start with "* " (rich-text paste) or have no bullet prefix
 * (plain-text paste from a <textarea>). The parser handles both by
 * detecting item boundaries from Qty/Price patterns when no bullets
 * are present.
 */

import type { ParsedLineItem } from "@/lib/normalize-product";

export interface ParsedPasteReceipt {
  store: "PUBLIX";
  items: ParsedLineItem[];
  rawText: string;
  purchaseDate?: Date;
  total?: number;
}

/**
 * Parse receipt from clipboard HTML. When the browser provides the HTML
 * representation of copied content, <li> elements map directly to items
 * and their inner text contains the structured Name / Size / Qty / Price lines.
 */
export function parsePublixPasteHtml(html: string): ParsedPasteReceipt {
  // The Publix website uses one <li> per line (name, size, qty, price, savings
  // are all separate <li> elements). Extract all <li> inner text values and
  // parse them using the same Qty-anchoring logic as the plain-text parser.
  const liBlocks = html.match(/<li[^>]*>[\s\S]*?<\/li>/gi) ?? [];

  const lines: string[] = [];
  for (const li of liBlocks) {
    const text = li
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(div|p|span|strong|em|b|i|a|img|svg|path|circle)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#?\w+;/g, "")
      .trim();
    if (text) lines.push(...text.split("\n").map((l) => l.trim()).filter(Boolean));
  }

  // Use the same Qty-anchoring approach as parseNoBulletMode
  const items = lines.length > 0 ? parseNoBulletMode(lines) : [];

  // Extract metadata from the inner text of the full HTML
  const fullText = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, "");
  const meta = extractMetadata(fullText);

  return { store: "PUBLIX", items, rawText: html, ...meta };
}

// Patterns that identify "structural" lines (not product names)
const QTY_RE = /^Qty:\s*(\d+)$/i;
const PRICE_RE = /^\$([\d,]+\.\d{2})$/;
const SAVED_RE = /^You saved \$([\d,]+\.\d{2})$/i;
const DATE_RE = /Your Publix trip on (\w+ \d{1,2}, \d{4})/i;
const TOTAL_LINE_RE = /^Total$/i;

/** Extract purchase date and total from the raw text lines. */
function extractMetadata(text: string): { purchaseDate?: Date; total?: number } {
  const result: { purchaseDate?: Date; total?: number } = {};

  const dateMatch = text.match(DATE_RE);
  if (dateMatch) {
    const d = new Date(dateMatch[1]);
    if (!isNaN(d.getTime())) result.purchaseDate = d;
  }

  // Total appears as a line "Total" followed by "$X.XX"
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    if (TOTAL_LINE_RE.test(lines[i])) {
      const pm = lines[i + 1]?.match(PRICE_RE);
      if (pm) {
        result.total = parseFloat(pm[1].replace(",", ""));
        break;
      }
    }
  }

  return result;
}
const NOISE_RE =
  /^(Skip to|Account|Home\/|Cart|Savings|Order|Catering|Delivery|Weekly|Pharmacy|Closed until|View receipt|Payment method|Order summary|Subtotal|Tax\b|Total\b|Credit Card|This purchase saved|Copyright|Need help|Settings|Perks|Shop with us|Work with us|Services you|More ways|Store Info|Contact Us|Terms of Use|Healthcare|Accessibility|Consumer Privacy|Your Privacy)/i;

/**
 * Returns true if a line looks like a size/weight description rather than
 * a product name. These appear between the product name and Qty line.
 */
function isSizeLine(line: string): boolean {
  // e.g. "28 oz (1.75 lb) 793 g", "8 oz", "12 fl oz (354 ml)", "1 Each", "1 Pkg", "1 Bunch"
  return /^\d[\d./]*\s*(oz|lb|fl|g|ml|pint|each|pkg|bunch|bag|slices|cartons|tray|clamshell|package)/i.test(line)
    || /^\d+\s*-\s*\d+/i.test(line); // "4 - 8 FL. OZ." multi-pack
}

export function parsePublixPasteReceipt(text: string): ParsedPasteReceipt {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const meta = extractMetadata(text);

  // Detect whether the text has bullet-prefixed product items
  // (rich-text paste preserves "* " from <li> elements)
  const hasBullets = lines.some(
    (l) =>
      l.startsWith("* ") &&
      !l.startsWith("* _") &&
      !NOISE_RE.test(l.slice(2).trim())
  );

  if (hasBullets) {
    return { store: "PUBLIX", items: parseBulletMode(lines), rawText: text, ...meta };
  }
  return { store: "PUBLIX", items: parseNoBulletMode(lines), rawText: text, ...meta };
}

/**
 * Bullet mode: items are delimited by "* " prefixes (rich-text clipboard).
 */
function parseBulletMode(lines: string[]): ParsedLineItem[] {
  const items: ParsedLineItem[] = [];
  let currentName: string | null = null;
  let currentQty = 1;
  let currentPrice: number | null = null;
  let currentSaved: number | null = null;

  function flush() {
    if (currentName && currentPrice !== null) {
      items.push(buildItem(currentName, currentPrice, currentQty, currentSaved));
    }
    currentName = null;
    currentQty = 1;
    currentPrice = null;
    currentSaved = null;
  }

  for (const line of lines) {
    if (line.startsWith("* ")) {
      const inner = line.slice(2).trim();
      if (inner.startsWith("_") || NOISE_RE.test(inner)) continue;
      flush();
      currentName = inner;
      continue;
    }
    if (currentName === null) continue;

    const qm = line.match(QTY_RE);
    if (qm) { currentQty = parseInt(qm[1], 10); continue; }
    const pm = line.match(PRICE_RE);
    if (pm) { currentPrice = parseFloat(pm[1].replace(",", "")); continue; }
    const sm = line.match(SAVED_RE);
    if (sm) { currentSaved = parseFloat(sm[1].replace(",", "")); continue; }
  }
  flush();
  return items;
}

/**
 * No-bullet mode: items are detected by anchoring on "Qty: N" lines and
 * looking backward for the product name and forward for the price.
 * This handles plain-text textarea pastes where <li> bullets are stripped.
 */
function parseNoBulletMode(lines: string[]): ParsedLineItem[] {
  const items: ParsedLineItem[] = [];

  // Pass 1: find indices of all "Qty:" lines
  const qtyIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (QTY_RE.test(lines[i])) qtyIndices.push(i);
  }

  for (const qi of qtyIndices) {
    const qtyMatch = lines[qi].match(QTY_RE)!;
    const qty = parseInt(qtyMatch[1], 10);

    // Look backward for product name (skip size lines)
    let name: string | null = null;
    for (let j = qi - 1; j >= 0; j--) {
      const candidate = lines[j];
      if (isSizeLine(candidate)) continue;
      // Stop if we hit another item's price, savings, qty, or noise
      if (PRICE_RE.test(candidate)) break;
      if (SAVED_RE.test(candidate)) break;
      if (QTY_RE.test(candidate)) break;
      if (NOISE_RE.test(candidate)) break;
      name = candidate;
      break;
    }
    if (!name) continue;

    // Look forward for price (next line after Qty should be $X.XX)
    // then optionally "You saved $X.XX" — stop as soon as we've found these
    let price: number | null = null;
    let saved: number | null = null;

    for (let j = qi + 1; j < lines.length && j <= qi + 3; j++) {
      if (price === null) {
        const pm = lines[j].match(PRICE_RE);
        if (pm) { price = parseFloat(pm[1].replace(",", "")); continue; }
      } else {
        // Already have price — only accept savings, stop on anything else
        const sm = lines[j].match(SAVED_RE);
        if (sm) { saved = parseFloat(sm[1].replace(",", "")); }
        break;
      }
      // Stop if we hit something unexpected before finding price
      if (QTY_RE.test(lines[j])) break;
      if (!NOISE_RE.test(lines[j]) && !isSizeLine(lines[j])) break;
    }

    if (price !== null) {
      items.push(buildItem(name, price, qty, saved));
    }
  }

  return items;
}

/**
 * Build a ParsedLineItem with correct unit prices.
 *
 * Publix shows the TOTAL price for all units (e.g. $7.75 for Qty: 2).
 * We divide by quantity to get the unit price.
 *
 * BOGO detection: when savings ≈ regular unit price, it's buy-one-get-one.
 * e.g. Kerrygold Qty: 2, $7.75 paid, saved $7.75 → regular unit = $7.75, BOGO free
 */
function buildItem(
  name: string,
  totalPaid: number,
  qty: number,
  totalSaved: number | null
): ParsedLineItem {
  const unitPaid = round2(totalPaid / qty);

  if (totalSaved !== null && totalSaved > 0) {
    const regularTotal = totalPaid + totalSaved;
    const regularUnit = round2(regularTotal / qty);

    // BOGO: savings ≈ one unit's regular price (within 2 cents)
    const isBogo = qty >= 2 && Math.abs(totalSaved - regularUnit) < 0.02;

    return {
      rawName: name,
      price: regularUnit,
      salePrice: unitPaid,
      quantity: qty > 1 ? qty : undefined,
      onSale: true,
      saleType: isBogo ? "BOGO" : "SALE",
    };
  }

  return {
    rawName: name,
    price: unitPaid,
    quantity: qty > 1 ? qty : undefined,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
