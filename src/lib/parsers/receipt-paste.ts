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
 * representation of copied content, we try two approaches:
 * 1. Extract structured data from Publix `purchase-details-row` elements
 * 2. Fall back to generic <li> text extraction + Qty-anchoring
 */
export function parsePublixPasteHtml(html: string): ParsedPasteReceipt {
  // Extract metadata from the inner text of the full HTML
  const fullText = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, "");
  const meta = extractMetadata(fullText);

  // Strategy 1: Parse Publix purchase-details-row structure directly
  const structuredItems = parsePublixDomStructure(html);
  if (structuredItems.length > 0) {
    return { store: "PUBLIX", items: structuredItems, rawText: html, ...meta };
  }

  // Strategy 2: Fall back to generic <li> extraction
  const liBlocks = html.match(/<li[^>]{0,200}>[\s\S]*?<\/li>/gi) ?? [];

  const lines: string[] = [];
  for (const li of liBlocks) {
    const text = stripHtml(li);
    if (text) lines.push(...splitInlinePatterns(text));
  }

  const items = lines.length > 0 ? parseNoBulletMode(lines) : [];
  return { store: "PUBLIX", items, rawText: html, ...meta };
}

/**
 * Parse Publix website DOM structure. The purchase-details page uses:
 *   <li class="purchase-details-row">
 *     <span class="product-name">...</span>
 *     <span class="product-qty">Qty: 2</span>
 *     <span class="color--publix-green-primary">$7.75</span>
 *     <span class="savings-amount">You saved $7.75</span>
 *   </li>
 *
 * Variations exist (class names may differ) but the structure is consistent.
 */
function parsePublixDomStructure(html: string): ParsedLineItem[] {
  // Match purchase-details-row blocks — use greedy match within each
  // by finding opening tag then content up to the next purchase-details-row or end
  const rowRegex = /<li[^>]{0,200}purchase-details-row[^>]{0,200}>([\s\S]*?)(?=<li[^>]{0,200}purchase-details-row|<\/ul|<\/ol|$)/gi;
  const items: ParsedLineItem[] = [];
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const block = match[1];

    // Extract text content, replacing tags with newlines
    const text = stripHtml(block);
    const lines = splitInlinePatterns(text);

    // Look for Qty, price, and savings in this block
    let name: string | null = null;
    let qty = 1;
    let price: number | null = null;
    let saved: number | null = null;

    // Also check for savings-amount class directly in the HTML block
    const savingsMatch = block.match(/savings-amount[^>]{0,100}>[^<]*\$([\d,]+\.\d{2})/i);
    if (savingsMatch) {
      saved = parseFloat(savingsMatch[1].replace(",", ""));
    }

    for (const line of lines) {
      const qm = line.match(QTY_RE);
      if (qm) { qty = parseInt(qm[1], 10); continue; }
      const pm = line.match(PRICE_RE);
      if (pm && price === null) { price = parseFloat(pm[1].replace(",", "")); continue; }
      const sm = line.match(SAVED_RE);
      if (sm && saved === null) { saved = parseFloat(sm[1].replace(",", "")); continue; }
      // Skip size lines, noise, and empty-ish lines
      if (isSizeLine(line)) continue;
      if (NOISE_RE.test(line)) continue;
      if (line.length < 2) continue;
      // First non-structural line is the product name
      if (!name) name = line;
    }

    if (name && price !== null) {
      items.push(buildItem(name, price, qty, saved));
    }
  }

  return items;
}

// Patterns that identify "structural" lines (not product names)
// These are anchored at both ends for exact-line matching after splitInlinePatterns
const QTY_RE = /^Qty:\s*(\d+)$/i;
const PRICE_RE = /^\$([\d,]+\.\d{2})$/;
const SAVED_RE = /^You saved \$([\d,]+\.\d{2})$/i;
const DATE_RE = /Your Publix trip on (\w+ \d{1,2}, \d{4})/i;
const TOTAL_LINE_RE = /^Total$/i;

// Inline patterns for splitting combined lines like "Qty: 2 $7.75 You saved $7.75"
const INLINE_QTY_RE = /Qty:\s*\d+/i;
const INLINE_PRICE_RE = /\$([\d,]+\.\d{2})/;
const INLINE_SAVED_RE = /You saved \$([\d,]+\.\d{2})/i;

/** Strip HTML tags, decode entities, return clean text */
function stripHtml(html: string): string {
  // Decode entities first so encoded tags like &lt;script&gt; are visible
  let text = html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#?\w+;/g, "");

  // Replace known block/inline tags with newlines, then strip all remaining tags.
  // Loop to handle any tags that were hidden inside encoded entities.
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(div|p|span|strong|em|b|i|a|img|svg|path|circle|ul|ol|li|button|label|input|select|option|header|footer|nav|section|article|aside|main|figure|figcaption|h[1-6])[^>]{0,200}>/gi, "\n");

  let prev;
  do {
    prev = text;
    text = text.replace(/<[^>]+>/g, "");
  } while (text !== prev);

  return text.trim();
}

/**
 * Split a text block into normalized lines. Handles cases where
 * Qty, price, and savings appear on the same line after HTML stripping.
 * e.g. "Kerrygold Butter 8 oz Qty: 2 $7.75 You saved $7.75"
 * becomes: ["Kerrygold Butter 8 oz", "Qty: 2", "$7.75", "You saved $7.75"]
 */
function splitInlinePatterns(text: string): string[] {
  const rawLines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const result: string[] = [];

  for (const line of rawLines) {
    // If line already matches a single pattern exactly, keep it
    if (QTY_RE.test(line) || PRICE_RE.test(line) || SAVED_RE.test(line)) {
      result.push(line);
      continue;
    }

    // Check if line contains inline patterns that need splitting
    const hasSaved = INLINE_SAVED_RE.test(line);
    const hasQty = INLINE_QTY_RE.test(line);
    const hasPrice = INLINE_PRICE_RE.test(line);

    if ((hasQty || hasPrice || hasSaved) && line.length > 20) {
      // Split out "You saved $X.XX" first (longest match)
      let remaining = line;
      if (hasSaved) {
        const savedMatch = remaining.match(INLINE_SAVED_RE)!;
        const idx = remaining.indexOf(savedMatch[0]);
        const before = remaining.slice(0, idx).trim();
        if (before) remaining = before;
        else remaining = remaining.slice(idx + savedMatch[0].length).trim();
        result.push(...splitInlinePatterns(remaining || ""));
        // Remove "remaining" from result if empty, then add saved
        result.push(savedMatch[0]);
        continue;
      }

      // Split out "Qty: N"
      if (hasQty) {
        const qtyMatch = remaining.match(INLINE_QTY_RE)!;
        const idx = remaining.indexOf(qtyMatch[0]);
        const before = remaining.slice(0, idx).trim();
        const after = remaining.slice(idx + qtyMatch[0].length).trim();
        if (before) result.push(before);
        result.push(qtyMatch[0]);
        if (after) result.push(...splitInlinePatterns(after));
        continue;
      }

      // Split out "$X.XX" when it's at the end of a name line
      if (hasPrice) {
        const priceMatch = remaining.match(INLINE_PRICE_RE)!;
        const idx = remaining.indexOf(priceMatch[0]);
        const before = remaining.slice(0, idx).trim();
        const after = remaining.slice(idx + priceMatch[0].length).trim();
        if (before) result.push(before);
        result.push(priceMatch[0]);
        if (after) result.push(...splitInlinePatterns(after));
        continue;
      }
    }

    result.push(line);
  }

  return result.filter(Boolean);
}

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
  const rawLines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  // Pre-process: split any lines that have inline Qty/price/savings patterns
  const lines = rawLines.flatMap((l) => splitInlinePatterns(l));
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
    if (pm && currentPrice === null) { currentPrice = parseFloat(pm[1].replace(",", "")); continue; }
    const sm = line.match(SAVED_RE);
    if (sm && currentSaved === null) { currentSaved = parseFloat(sm[1].replace(",", "")); continue; }
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

    // Look forward for price and optionally "You saved $X.XX"
    // Check up to 4 lines ahead to handle extra whitespace/separator lines
    let price: number | null = null;
    let saved: number | null = null;

    for (let j = qi + 1; j < lines.length && j <= qi + 5; j++) {
      const sm = lines[j].match(SAVED_RE);
      if (sm) {
        saved = parseFloat(sm[1].replace(",", ""));
        // If we already have price, we're done
        if (price !== null) break;
        continue;
      }
      if (price === null) {
        const pm = lines[j].match(PRICE_RE);
        if (pm) { price = parseFloat(pm[1].replace(",", "")); continue; }
      }
      // Stop if we hit another item's Qty
      if (QTY_RE.test(lines[j])) break;
      // Stop on noise, but skip size lines
      if (isSizeLine(lines[j])) continue;
      if (NOISE_RE.test(lines[j])) break;
      // If we already have price, stop on any non-savings, non-noise line
      if (price !== null) break;
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
