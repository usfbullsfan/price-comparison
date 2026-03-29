/**
 * Parse receipt/cart data captured from Chrome DevTools network requests.
 *
 * How to capture:
 *  1. Open Chrome DevTools → Network tab
 *  2. Browse to your order history on Publix/Walmart/Target website
 *  3. Find the XHR/Fetch request that returns your order data (usually JSON)
 *  4. Right-click → Copy → Copy Response
 *  5. Paste into the DevTools JSON input on the upload page
 *
 * This parser handles the most common response shapes from each store.
 * You can extend it as you encounter new formats.
 */

import type { ParsedLineItem } from "@/lib/normalize-product";

export interface ParsedDevToolsReceipt {
  items: ParsedLineItem[];
  purchaseDate?: Date;
  total?: number;
  tax?: number;
  detectedFormat: string;
}

// ---- Publix ----

function tryParsePublix(data: unknown): ParsedLineItem[] | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // Publix API typically nests items under "orderDetails.lineItems" or "items"
  const lineItems = (
    (d.orderDetails as Record<string, unknown>)?.lineItems ??
    d.lineItems ??
    d.items ??
    (d.data as Record<string, unknown>)?.lineItems
  ) as unknown[] | undefined;

  if (!Array.isArray(lineItems)) return null;

  return lineItems.flatMap((item) => {
    const i = item as Record<string, unknown>;
    const rawName =
      (i.description as string) ??
      (i.productName as string) ??
      (i.name as string);
    const price =
      Number(i.unitPrice ?? i.price ?? i.regularPrice ?? i.listPrice) || 0;
    if (!rawName || price <= 0) return [];
    return [{ rawName, price, upc: (i.upc as string) ?? (i.itemCode as string) }];
  });
}

// ---- Walmart ----

function tryParseWalmart(data: unknown): ParsedLineItem[] | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // Walmart returns order lines under data.customer.orders or similar
  const lines = findNestedArray(d, [
    "orderLines",
    "orderItems",
    "lineItems",
    "items",
  ]);
  if (!lines) return null;

  return lines.flatMap((item) => {
    const i = item as Record<string, unknown>;
    const item2 = (i.item as Record<string, unknown>) ?? i;
    const rawName =
      (item2.productName as string) ??
      (item2.description as string) ??
      (i.name as string);
    const priceInfo = (i.charges as Record<string, unknown>[])?.[0];
    const price =
      Number(
        ((priceInfo as Record<string, unknown>)?.chargeAmount as Record<string, unknown>)?.amount ??
          i.unitPrice ??
          i.price
      ) || 0;
    if (!rawName || price <= 0) return [];
    const upc = (item2.upc as string) ?? (item2.offerId as string);
    return [{ rawName, price, upc }];
  });
}

// ---- Target ----

function tryParseTarget(data: unknown): ParsedLineItem[] | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  const lines = findNestedArray(d, [
    "order_lines",
    "orderLines",
    "cartItems",
    "items",
  ]);
  if (!lines) return null;

  return lines.flatMap((item) => {
    const i = item as Record<string, unknown>;
    const product = (i.item as Record<string, unknown>) ?? (i.product as Record<string, unknown>) ?? i;
    const rawName =
      (product.title as string) ??
      (product.item_title as string) ??
      (product.description as string);
    const price =
      Number(
        (((product as Record<string, unknown>).price as Record<string, unknown>)?.formatted_current_price as string | undefined)?.replace(/[^0-9.]/g, "") ??
          i.unit_price ??
          i.price
      ) || 0;
    if (!rawName || price <= 0) return [];
    const upc = (product.tcin as string) ?? (product.dpci as string);
    return [{ rawName, price, upc }];
  });
}

// ---- Generic fallback ----

function tryParseGeneric(data: unknown): ParsedLineItem[] | null {
  const lines = findNestedArray(data as Record<string, unknown>, [
    "lineItems",
    "items",
    "products",
    "orderItems",
    "cartItems",
  ]);
  if (!lines) return null;

  return lines.flatMap((item) => {
    const i = item as Record<string, unknown>;
    const rawName =
      (i.name as string) ??
      (i.description as string) ??
      (i.title as string) ??
      (i.productName as string);
    const price = Number(i.price ?? i.unitPrice ?? i.amount) || 0;
    if (!rawName || price <= 0) return [];
    return [{ rawName, price }];
  });
}

// ---- Helpers ----

function findNestedArray(
  obj: Record<string, unknown>,
  keys: string[],
  depth = 0
): unknown[] | null {
  if (depth > 10) return null;
  for (const key of keys) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = findNestedArray(val as Record<string, unknown>, keys, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

// ---- Main export ----

export function parseDevToolsJson(jsonString: string): ParsedDevToolsReceipt {
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch {
    throw new Error("Invalid JSON — paste the raw response body from DevTools");
  }

  const text = jsonString.toLowerCase();
  const isWalmart = text.includes("walmart") || text.includes("walmartorderid");
  const isTarget = text.includes("target") || text.includes("tcin");

  let items: ParsedLineItem[] | null = null;
  let detectedFormat = "unknown";

  if (isWalmart) {
    items = tryParseWalmart(data);
    detectedFormat = "walmart";
  } else if (isTarget) {
    items = tryParseTarget(data);
    detectedFormat = "target";
  } else {
    items = tryParsePublix(data);
    detectedFormat = "publix";
  }

  if (!items || items.length === 0) {
    items = tryParseGeneric(data);
    detectedFormat = "generic";
  }

  if (!items || items.length === 0) {
    throw new Error(
      "Could not parse any line items from this JSON. Try a different network request."
    );
  }

  // Try to extract date and total
  const d = data as Record<string, unknown>;
  const dateStr =
    (d.orderDate as string) ??
    (d.purchaseDate as string) ??
    (d.createdAt as string) ??
    findStringByKey(d, ["orderDate", "purchaseDate", "transactionDate", "createdAt"]);
  const purchaseDate = dateStr ? new Date(dateStr) : undefined;

  const totalRaw =
    (d.total as number) ??
    findNumberByKey(d, ["total", "orderTotal", "grandTotal", "subtotal"]);
  const total = totalRaw ? Number(totalRaw) : undefined;

  return {
    items,
    purchaseDate: purchaseDate && !isNaN(purchaseDate.getTime()) ? purchaseDate : undefined,
    total,
    detectedFormat,
  };
}

function findStringByKey(
  obj: Record<string, unknown>,
  keys: string[],
  depth = 0
): string | undefined {
  if (depth > 10) return undefined;
  for (const key of keys) {
    if (typeof obj[key] === "string") return obj[key] as string;
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const found = findStringByKey(val as Record<string, unknown>, keys, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function findNumberByKey(
  obj: Record<string, unknown>,
  keys: string[],
  depth = 0
): number | undefined {
  if (depth > 10) return undefined;
  for (const key of keys) {
    if (typeof obj[key] === "number") return obj[key] as number;
    if (typeof obj[key] === "string" && !isNaN(parseFloat(obj[key] as string)))
      return parseFloat(obj[key] as string);
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const found = findNumberByKey(val as Record<string, unknown>, keys, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
