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
}

/**
 * Parse receipt from clipboard HTML. When the browser provides the HTML
 * representation of copied content, <li> elements map directly to items
 * and their inner text contains the structured Name / Size / Qty / Price lines.
 */
export function parsePublixPasteHtml(html: string): ParsedPasteReceipt {
  // Extract text content from each <li> that contains a Qty pattern.
  // We strip tags to get the inner text of each <li>.
  const liBlocks = html.match(/<li[^>]*>[\s\S]*?<\/li>/gi) ?? [];

  const items: ParsedLineItem[] = [];

  for (const li of liBlocks) {
    // Strip HTML tags to get inner text
    const text = li
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(div|p|span|strong|em|b|i|a|img|svg|path|circle)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#?\w+;/g, "")
      .trim();

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    // Only process <li> blocks that have a Qty line
    const qtyIdx = lines.findIndex((l) => QTY_RE.test(l));
    if (qtyIdx === -1) continue;

    const qtyMatch = lines[qtyIdx].match(QTY_RE)!;
    const qty = parseInt(qtyMatch[1], 10);

    // Product name: first non-size, non-structural line
    let name: string | null = null;
    for (let j = 0; j < qtyIdx; j++) {
      if (isSizeLine(lines[j])) continue;
      if (PRICE_RE.test(lines[j])) continue;
      if (NOISE_RE.test(lines[j])) continue;
      name = lines[j];
      break;
    }
    if (!name) continue;

    // Price + savings: after Qty line
    let price: number | null = null;
    let saved: number | null = null;
    for (let j = qtyIdx + 1; j < lines.length; j++) {
      const pm = lines[j].match(PRICE_RE);
      if (pm) { price = parseFloat(pm[1].replace(",", "")); continue; }
      const sm = lines[j].match(SAVED_RE);
      if (sm) { saved = parseFloat(sm[1].replace(",", "")); break; }
    }

    if (price !== null) {
      items.push(buildItem(name, price, qty, saved));
    }
  }

  return { store: "PUBLIX", items, rawText: html };
}

// Patterns that identify "structural" lines (not product names)
const QTY_RE = /^Qty:\s*(\d+)$/i;
const PRICE_RE = /^\$([\d,]+\.\d{2})$/;
const SAVED_RE = /^You saved \$([\d,]+\.\d{2})$/i;
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

  // Detect whether the text has bullet-prefixed product items
  // (rich-text paste preserves "* " from <li> elements)
  const hasBullets = lines.some(
    (l) =>
      l.startsWith("* ") &&
      !l.startsWith("* _") &&
      !NOISE_RE.test(l.slice(2).trim())
  );

  if (hasBullets) {
    return { store: "PUBLIX", items: parseBulletMode(lines), rawText: text };
  }
  return { store: "PUBLIX", items: parseNoBulletMode(lines), rawText: text };
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
    let price: number | null = null;
    let saved: number | null = null;

    for (let j = qi + 1; j < lines.length && j <= qi + 3; j++) {
      const pm = lines[j].match(PRICE_RE);
      if (pm) { price = parseFloat(pm[1].replace(",", "")); continue; }
      const sm = lines[j].match(SAVED_RE);
      if (sm) { saved = parseFloat(sm[1].replace(",", "")); break; }
      // Stop if we hit something unexpected
      if (QTY_RE.test(lines[j])) break;
      if (!NOISE_RE.test(lines[j]) && !isSizeLine(lines[j])) break;
    }

    if (price !== null) {
      items.push(buildItem(name, price, qty, saved));
    }
  }

  return items;
}

function buildItem(
  name: string,
  price: number,
  qty: number,
  saved: number | null
): ParsedLineItem {
  const item: ParsedLineItem = {
    rawName: name,
    price,
    quantity: qty > 1 ? qty : undefined,
  };
  if (saved !== null && saved > 0) {
    item.onSale = true;
    item.salePrice = item.price;
    item.price = item.price + saved;
  }
  return item;
}
