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
 * Each item block starts with "* " and contains full product names,
 * optional size info, quantity, price, and optional savings.
 */

import type { ParsedLineItem } from "@/lib/normalize-product";

export interface ParsedPasteReceipt {
  store: "PUBLIX";
  items: ParsedLineItem[];
  rawText: string;
}

export function parsePublixPasteReceipt(text: string): ParsedPasteReceipt {
  const lines = text.split("\n");
  const items: ParsedLineItem[] = [];

  let currentName: string | null = null;
  let currentQty = 1;
  let currentPrice: number | null = null;
  let currentSaved: number | null = null;

  function flushItem() {
    if (currentName && currentPrice !== null) {
      const item: ParsedLineItem = {
        rawName: currentName,
        price: currentPrice,
        quantity: currentQty > 1 ? currentQty : undefined,
      };

      if (currentSaved !== null && currentSaved > 0) {
        item.onSale = true;
        // The displayed price is what they paid; the regular price was higher
        item.salePrice = item.price;
        item.price = item.price + currentSaved;
      }

      items.push(item);
    }
    currentName = null;
    currentQty = 1;
    currentPrice = null;
    currentSaved = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // New item block starts with "* "
    if (trimmed.startsWith("* ")) {
      flushItem();
      currentName = trimmed.slice(2).trim();
      continue;
    }

    // Only parse detail lines if we're inside an item block
    if (currentName === null) continue;

    // Quantity line: "Qty: 2"
    const qtyMatch = trimmed.match(/^Qty:\s*(\d+)$/i);
    if (qtyMatch) {
      currentQty = parseInt(qtyMatch[1], 10);
      continue;
    }

    // Price line: "$5.79" or "$20.24"
    const priceMatch = trimmed.match(/^\$([\d,]+\.\d{2})$/);
    if (priceMatch) {
      currentPrice = parseFloat(priceMatch[1].replace(",", ""));
      continue;
    }

    // Savings line: "You saved $7.75"
    const savedMatch = trimmed.match(/^You saved \$([\d,]+\.\d{2})$/i);
    if (savedMatch) {
      currentSaved = parseFloat(savedMatch[1].replace(",", ""));
      continue;
    }

    // Other lines (size info, etc.) — skip for now
  }

  // Flush the last item
  flushItem();

  return { store: "PUBLIX", items, rawText: text };
}
