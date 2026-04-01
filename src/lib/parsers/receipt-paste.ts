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
  storeLocation?: string;
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
    .replace(/&#?\w+;/g, "")
    .replace(/&amp;/g, "&");
  const meta = extractMetadata(fullText);

  // Strategy 1: Parse Publix purchase-details-row structure directly
  const structuredItems = parsePublixDomStructure(html);
  if (structuredItems.length > 0) {
    return { store: "PUBLIX", items: detectCrossVariantBogo(structuredItems), rawText: html, ...meta };
  }

  // Strategy 2: Fall back to generic <li> extraction
  // Extract <li>...</li> blocks without regex to avoid ReDoS on malformed HTML
  const liBlocks: string[] = [];
  const liOpenRe = /<li[^>]{0,2000}>/gi;
  let liMatch;
  while ((liMatch = liOpenRe.exec(html)) !== null) {
    const start = liMatch.index;
    const closeIdx = html.indexOf("</li>", start);
    if (closeIdx !== -1) {
      liBlocks.push(html.slice(start, closeIdx + 5));
    }
  }

  const lines: string[] = [];
  for (const li of liBlocks) {
    const text = stripHtml(li);
    if (text) lines.push(...splitInlinePatterns(text));
  }

  const items = lines.length > 0 ? parseNoBulletMode(lines) : [];
  return { store: "PUBLIX", items: detectCrossVariantBogo(items), rawText: html, ...meta };
}

/**
 * Parse Publix website DOM structure. The purchase-details page uses
 * `<li>` rows (often with class "purchase-details-row") containing nested
 * divs like "items-left" (product name, size) and "items-right" (qty, price).
 *
 * The exact class names vary between Publix site versions, so we try
 * multiple strategies:
 *   1. Look for `purchase-details-row` <li> blocks
 *   2. Look for any <li> that contains both a Qty pattern and a $ price
 */
function parsePublixDomStructure(html: string): ParsedLineItem[] {
  // Strategy 1: Find purchase-details-row blocks
  const rowItems = parseRowsByClass(html, /purchase-details-row/i);
  if (rowItems.length > 0) return rowItems;

  // Strategy 2: Find any <li> blocks that contain Qty + price patterns
  const liItems = parseGenericLiBlocks(html);
  if (liItems.length > 0) return liItems;

  return [];
}

/** Extract items from <li> elements matching a given class pattern */
function parseRowsByClass(html: string, classPattern: RegExp): ParsedLineItem[] {
  const tagRe = /<li[^>]{0,2000}>/gi;
  const items: ParsedLineItem[] = [];
  let tagMatch;

  while ((tagMatch = tagRe.exec(html)) !== null) {
    const tag = tagMatch[0];
    if (!classPattern.test(tag)) continue;

    const contentStart = tagMatch.index + tag.length;
    const closeIdx = findClosingTag(html, contentStart, "li");
    if (closeIdx === -1) continue;

    const block = html.slice(contentStart, closeIdx);
    const item = extractItemFromBlock(block);
    if (item) items.push(item);
  }

  return items;
}

/** Find <li> blocks that contain both Qty and price patterns */
function parseGenericLiBlocks(html: string): ParsedLineItem[] {
  const tagRe = /<li[^>]{0,2000}>/gi;
  const items: ParsedLineItem[] = [];
  let tagMatch;

  while ((tagMatch = tagRe.exec(html)) !== null) {
    const contentStart = tagMatch.index + tagMatch[0].length;
    const closeIdx = findClosingTag(html, contentStart, "li");
    if (closeIdx === -1) continue;

    const block = html.slice(contentStart, closeIdx);
    // Only consider blocks that have both Qty and a dollar price
    if (!/Qty:\s*\d+/i.test(block)) continue;
    if (!/\$[\d,]+\.\d{2}/.test(block)) continue;

    const item = extractItemFromBlock(block);
    if (item) items.push(item);
  }

  return items;
}

/** Find the matching closing tag, handling nested same-type tags */
function findClosingTag(html: string, startAfterOpen: number, tag: string): number {
  const openRe = new RegExp(`<${tag}[\\s>]`, "gi");
  const closeStr = `</${tag}>`;
  let depth = 1;
  let pos = startAfterOpen;

  while (depth > 0 && pos < html.length) {
    const nextOpen = html.indexOf(`<${tag}`, pos);
    const nextClose = html.indexOf(closeStr, pos);

    if (nextClose === -1) return -1; // no closing tag found

    if (nextOpen !== -1 && nextOpen < nextClose) {
      // Verify it's actually an opening tag (not </tag or <tagOther)
      openRe.lastIndex = nextOpen;
      const m = openRe.exec(html);
      if (m && m.index === nextOpen) {
        depth++;
      }
      pos = nextOpen + tag.length + 1;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      pos = nextClose + closeStr.length;
    }
  }

  return -1;
}

/**
 * Extract a single ParsedLineItem from an HTML block (the inner content
 * of a <li> element). Uses the text content, splitting on structural
 * patterns, and picks the first non-structural line as the product name.
 */
function extractItemFromBlock(block: string): ParsedLineItem | null {
  const text = stripHtml(block);
  const lines = splitInlinePatterns(text);

  let name: string | null = null;
  let qty = 1;
  let price: number | null = null;
  let saved: number | null = null;

  // Check for savings-amount class directly in the HTML
  const savingsMatch = block.match(/savings-amount[^>]{0,100}>[^<]{0,200}\$([\d,]+\.\d{2})/i);
  if (savingsMatch) {
    saved = parseFloat(savingsMatch[1].replace(",", ""));
  }

  // Also try to extract product name from known Publix class patterns
  // e.g. <p class="...paragraph-md...">Product Name</p>
  // or <span class="product-name">Product Name</span>
  const nameFromClass = extractNameByClass(block);

  for (const line of lines) {
    const qm = line.match(QTY_RE);
    if (qm) { qty = parseInt(qm[1], 10); continue; }
    const pm = line.match(PRICE_RE);
    if (pm && price === null) { price = parseFloat(pm[1].replace(",", "")); continue; }
    const sm = line.match(SAVED_RE);
    if (sm && saved === null) { saved = parseFloat(sm[1].replace(",", "")); continue; }
    if (isSizeLine(line)) continue;
    if (NOISE_RE.test(line)) continue;
    if (line.length < 2) continue;
    if (!name) name = line;
  }

  // Prefer the class-extracted name if the text-extracted name looks like a size
  if (nameFromClass && (!name || isSizeLine(name) || name.length < nameFromClass.length / 2)) {
    name = nameFromClass;
  }

  if (name && price !== null) {
    return buildItem(name, price, qty, saved);
  }
  return null;
}

/**
 * Try to extract a product name from known Publix HTML class patterns.
 * These include: "paragraph-md", "product-name", "p-text", "items-left"
 */
function extractNameByClass(block: string): string | null {
  // Try several class-based patterns
  const patterns = [
    // Publix uses <div class="p-text paragraph-md ... color--null">Product Name</div>
    // Size lines use color--neutral-70; product names use color--null
    /<(?:p|div)[^>]{0,500}paragraph-md[^>]{0,500}color--null[^>]{0,200}>([^<]{3,200})<\/(?:p|div)>/i,
    // Publix uses <p/div class="p-text paragraph-md ...">Product Name</p/div>
    /<(?:p|div)[^>]{0,500}paragraph-md[^>]{0,500}>([^<]{3,200})<\/(?:p|div)>/i,
    // <span class="product-name">...</span>
    /<[^>]{0,50}product-name[^>]{0,100}>([^<]{3,200})<\//i,
    // items-left div containing a <p>, <span>, or <div> with the name
    /items-left[^>]{0,200}>[\s\S]{0,500}?<(?:p|span|div)[^>]{0,500}>([^<]{3,200})<\/(?:p|span|div)>/i,
  ];

  for (const re of patterns) {
    const m = block.match(re);
    if (m) {
      const text = m[1].trim();
      // Make sure it's not a size line or structural text
      if (text.length >= 3 && !isSizeLine(text) && !NOISE_RE.test(text) && !QTY_RE.test(text) && !PRICE_RE.test(text)) {
        return text;
      }
    }
  }

  return null;
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
  // Decode entities first so encoded tags like &lt;script&gt; are visible.
  // Decode &amp; last to avoid double-unescaping (e.g. &amp;lt; → &lt; → <).
  let text = html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#?\w+;/g, "")
    .replace(/&amp;/g, "&");

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

/** Extract purchase date, total, and store location from the raw text lines. */
function extractMetadata(text: string): { purchaseDate?: Date; total?: number; storeLocation?: string } {
  const result: { purchaseDate?: Date; total?: number; storeLocation?: string } = {};

  const dateMatch = text.match(DATE_RE);
  if (dateMatch) {
    const d = new Date(dateMatch[1]);
    if (!isNaN(d.getTime())) result.purchaseDate = d;
  }

  // Total appears as a line "Total" followed by "$X.XX"
  // When HTML is stripped to text, empty lines may separate them, so skip blanks.
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    if (TOTAL_LINE_RE.test(lines[i])) {
      // Look ahead past empty lines for the price
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j] === "") continue;
        const pm = lines[j].match(PRICE_RE);
        if (pm) {
          result.total = parseFloat(pm[1].replace(",", ""));
        }
        break;
      }
      if (result.total !== undefined) break;
    }
  }

  // Store location: Publix pages often show "Store details" or an address
  // Look for patterns like "Publix at <Location>" or "Publix Super Market at ..."
  // or a street address line (number + street name) near "Store details"
  const locationMatch = text.match(/Publix(?:\s+Super\s+Market(?:s)?)?\s+at\s+(.+)/i);
  if (locationMatch) {
    result.storeLocation = locationMatch[1].trim().split("\n")[0].trim();
  } else {
    // Look for a street address pattern near the top of the text or near "Store details"
    // Common format: "1234 Main Street, City, FL 33333" or "Store #1234"
    const storeNumMatch = text.match(/Store\s*#?\s*(\d{3,5})/i);
    if (storeNumMatch) {
      result.storeLocation = `Store #${storeNumMatch[1]}`;
    } else {
      // Try to find an address line: digits + street name + city/state
      const addressMatch = text.match(/(\d{2,6}\s+[A-Z][a-zA-Z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Pkwy|Hwy|Circle|Boulevard|Drive|Road|Lane|Street|Avenue|Place|Court|Highway|Parkway)[.,]?\s+[A-Za-z\s]+,?\s*[A-Z]{2}\s*\d{5})/i);
      if (addressMatch) {
        result.storeLocation = addressMatch[1].trim();
      }
    }
  }

  return result;
}
const NOISE_RE =
  /^(Skip to|Account|Home\/|Cart|Savings|Order|Catering|Delivery|Weekly|Pharmacy|Closed until|View receipt|Payment method|Order summary|Subtotal|Tax\b|Total\b|Credit Card|This purchase saved|Copyright|Need help|Settings|Perks|Shop with us|Work with us|Services you|More ways|Store Info|Contact Us|Terms of Use|Healthcare|Accessibility|Consumer Privacy|Your Privacy|Publix$|My Lists|Digital Coupons|Store details|Search|Log in|Log out|Sign in|Sign up|Club Publix|Gift Cards|Recipes|SNAP EBT|Pickup|In.store|Instacart|\d+ items?$)/i;

/**
 * Returns true if a line looks like a size/weight description rather than
 * a product name. These appear between the product name and Qty line.
 *
 * Uses structural heuristics rather than an exhaustive unit list, since
 * units vary dramatically (bottles, ct, sticks, clamshells, etc.).
 *
 * Key insight: size lines START with a number and are SHORT. Product names
 * almost never start with a digit (except brand names like "365 Organic"
 * which are longer and contain multiple words including a brand/noun).
 */
function isSizeLine(line: string): boolean {
  // "NET WT 18 OZ (1 LB 2 OZ) 510g", "NET WT 14.5 OZ (411g)"
  if (/^NET\s+WT\b/i.test(line)) return true;

  // Lines where the unit is directly attached to the number:
  // "8.5oz / 241g", "16oz", "241g", "1.5L", "12ct"
  if (/^\d[\d.]*(?:oz|fl\.?\s*oz|g|kg|mg|ml|l|lb|lbs|ct|pk|pt|qt|gal)\b/i.test(line)) return true;

  // Spelled-out number followed by a unit:
  // "one quart (946 ml)", "two liters", "half gallon", "a pint"
  if (/^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|quarter|a)\s+(?:quart|pint|gallon|liter|litre|pound|ounce|cup|bottle|can|pack|count|piece|each|dozen|pair|roll|oz|lb|pt|qt|gal)s?\b/i.test(line)) return true;

  // Lines that start with a standalone number (number followed by space).
  // "8 oz", "1 bottle", "12 ct" → size lines
  // "7Up Cherry" → NOT a size (digit is part of the word "7Up")
  // "365 Whole Foods" → NOT a size (it's a brand name)
  if (/^\d[\d./]*\s/.test(line)) {
    const wordCount = line.split(/\s+/).length;

    // 1-2 words: "8 oz", "1 bottle", "12 ct" → always a size
    if (wordCount <= 2) return true;

    // 3+ words: use heuristics to distinguish sizes from product names
    // Sizes: "12 fl oz", "6 rolls [13.1 oz]", "28 oz (1.75 lb) 793 g"
    // Products: "365 Whole Foods Organic Milk", "2000 Flushes Blue"
    if (line.length <= 50) {
      const afterNumber = line.replace(/^[\d./]+\s+/, "");
      // Count words that start with an uppercase letter and have 3+ chars
      // Product names have multiple capitalized words; size lines don't
      const capitalizedWords = afterNumber.match(/\b[A-Z][a-z]{2,}/g) || [];
      if (capitalizedWords.length < 2) return true;
    }

    // Range patterns: "4 - 8 FL. OZ.", "2-3 servings"
    if (/^\d+\s*-\s*\d+/i.test(line) && line.length <= 30) return true;

    // Purely numeric with parenthetical: "12 (355 ml)"
    if (/^\d[\d./]*\s*\([\d.\s,a-z]+\)\s*$/i.test(line)) return true;
  }

  return false;
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
    return { store: "PUBLIX", items: detectCrossVariantBogo(parseBulletMode(lines)), rawText: text, ...meta };
  }
  return { store: "PUBLIX", items: detectCrossVariantBogo(parseNoBulletMode(lines)), rawText: text, ...meta };
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

/**
 * Detect cross-variant BOGO deals and adjust pricing.
 *
 * Publix BOGO pattern for different varieties: one item at full price ($X.XX)
 * with no sale flag, paired with another item from the same brand at $0.00
 * sale price with "You saved $X.XX" equal to the full retail price.
 *
 * When detected, both items are marked BOGO at half the retail price.
 *
 * Example:
 *   Ritz Bits Cheese: price=$4.85, not on sale
 *   Ritz Bits PB: price=$4.85, salePrice=$0.00, saved=$4.85
 *   → Both become: price=$4.85, salePrice=$2.43, saleType="BOGO"
 */
function detectCrossVariantBogo(items: ParsedLineItem[]): ParsedLineItem[] {
  // Find items that are the "free" half: onSale with salePrice === 0
  const freeIndices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].onSale && items[i].salePrice === 0) {
      freeIndices.push(i);
    }
  }

  if (freeIndices.length === 0) return items;

  const result = items.map((it) => ({ ...it }));
  const matched = new Set<number>();

  for (const fi of freeIndices) {
    const freeItem = result[fi];
    const brand = extractBrandPrefix(freeItem.rawName);
    if (!brand) continue;

    // Find a non-sale item with the same brand prefix and same retail price
    let bestMatch = -1;
    let bestScore = 0;
    for (let i = 0; i < result.length; i++) {
      if (i === fi || matched.has(i)) continue;
      const candidate = result[i];
      // Must not already be on sale, and must have matching retail price
      if (candidate.onSale) continue;
      if (Math.abs(candidate.price - freeItem.price) > 0.02) continue;

      const candidateBrand = extractBrandPrefix(candidate.rawName);
      if (!candidateBrand) continue;

      // Brand must match
      if (brand.toLowerCase() !== candidateBrand.toLowerCase()) continue;

      // Score by how similar the full names are (prefer closer matches)
      const score = commonPrefixLength(freeItem.rawName, candidate.rawName);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = i;
      }
    }

    if (bestMatch !== -1) {
      // Split price evenly; if odd cent, one gets floor, other gets ceil
      // so the two always sum to the original price
      const halfLow = Math.floor(freeItem.price * 100 / 2) / 100;
      const halfHigh = round2(freeItem.price - halfLow);

      result[fi].salePrice = halfLow;
      result[fi].saleType = "BOGO";
      result[fi].onSale = true;

      result[bestMatch].salePrice = halfHigh;
      result[bestMatch].saleType = "BOGO";
      result[bestMatch].onSale = true;

      matched.add(fi);
      matched.add(bestMatch);
    }
  }

  return result;
}

/**
 * Extract a brand prefix from a product name. The brand is typically
 * the first 1-3 words before the variety/flavor description begins.
 *
 * Examples:
 *   "Ritz RITZ Bits Cheese Sandwich Crackers" → "Ritz RITZ Bits"
 *   "Second Nature California Medley" → "Second Nature"
 *   "Kerrygold Butter Naturally Softer" → "Kerrygold"
 */
function extractBrandPrefix(name: string): string | null {
  // Clean: remove leading/trailing whitespace
  const clean = name.trim();
  if (!clean) return null;

  const words = clean.split(/\s+/);
  if (words.length < 2) return words[0] || null;

  // Return first 2-3 words as brand prefix (most brands are 1-3 words)
  // We'll use up to 3 words, stopping if we hit a common flavor/variety word
  const flavorWords = new Set([
    "cheese", "cheddar", "peanut", "butter", "chocolate", "vanilla",
    "strawberry", "blueberry", "raspberry", "original", "classic",
    "honey", "bbq", "ranch", "plain", "salted", "unsalted",
    "california", "simplicity", "garden", "harvest", "medley",
    "crispy", "crunchy", "creamy", "smooth", "chunky",
    "mild", "spicy", "hot", "sweet", "sour",
  ]);

  const brandWords: string[] = [];
  for (let i = 0; i < Math.min(words.length, 4); i++) {
    if (i >= 2 && flavorWords.has(words[i].toLowerCase())) break;
    brandWords.push(words[i]);
    if (i >= 2) break; // max 3 words
  }

  return brandWords.join(" ");
}

function commonPrefixLength(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
