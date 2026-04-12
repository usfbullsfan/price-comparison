/**
 * AI-first receipt paste parser.
 *
 * Tries the AI provider first for structured extraction from pasted text/HTML.
 * Falls back to the existing regex-based parser if AI is unavailable or
 * returns results that fail validation.
 *
 * This wrapper reduces maintenance burden by delegating the fragile
 * text parsing to an LLM while keeping the battle-tested regex parser
 * as a safety net.
 */

import { getAIProvider } from "@/lib/ai/provider";
import type { ReceiptMetadata } from "@/lib/ai/provider";
import type { ParsedLineItem } from "@/lib/normalize-product";
import {
  parsePublixPasteHtml,
  parsePublixPasteReceipt,
  type ParsedPasteReceipt,
} from "./receipt-paste";

export interface AIPasteParseResult extends ParsedPasteReceipt {
  parseMethod: "ai" | "regex";
  aiConfidence?: number;
}

/**
 * Parse a pasted receipt using AI first, falling back to regex.
 *
 * @param text - The plain text pasted by the user (always present)
 * @param html - The HTML clipboard representation (may be undefined)
 * @param store - The store this receipt is from (default: "PUBLIX")
 */
export async function parseReceiptPasteAI(
  text: string,
  html: string | undefined,
  store = "PUBLIX"
): Promise<AIPasteParseResult> {
  const provider = getAIProvider();

  if (provider) {
    try {
      const aiResult = await provider.parseReceiptText(text, {
        store,
        source: "paste",
        format: html ? "store_website_html" : "store_website_text",
      });

      const validation = validateAIResult(aiResult.items, aiResult.metadata, text);

      if (validation.valid) {
        return {
          store: (aiResult.metadata.store as "PUBLIX") ?? "PUBLIX",
          items: aiResult.items,
          rawText: text,
          purchaseDate: aiResult.metadata.purchaseDate
            ? new Date(aiResult.metadata.purchaseDate)
            : undefined,
          total: aiResult.metadata.total,
          storeLocation: aiResult.metadata.storeLocation,
          parseMethod: "ai",
        };
      }

      // AI returned something but it failed validation — fall through to regex
      console.warn(
        `AI parse failed validation (${validation.reason}), falling back to regex`
      );
    } catch (err) {
      console.warn("AI parse error, falling back to regex:", err);
    }
  }

  // Regex fallback
  return regexFallback(text, html);
}

/**
 * Validate AI-parsed items to ensure they're reasonable before accepting.
 */
function validateAIResult(
  items: ParsedLineItem[],
  metadata: ReceiptMetadata,
  _originalText: string
): { valid: boolean; reason?: string } {
  // Must have at least 1 item
  if (items.length === 0) {
    return { valid: false, reason: "no items returned" };
  }

  // All items must have a name and positive price
  for (const item of items) {
    if (!item.rawName || item.rawName.trim().length === 0) {
      return { valid: false, reason: "item with empty name" };
    }
    if (typeof item.price !== "number" || item.price <= 0) {
      return { valid: false, reason: `invalid price for "${item.rawName}": ${item.price}` };
    }
    // Sanity: no single grocery item should cost more than $200
    if (item.price > 200) {
      return { valid: false, reason: `unreasonable price for "${item.rawName}": $${item.price}` };
    }
  }

  // If we know the total, verify items sum is within 20%
  // (allow generous margin because tax, discounts, and weighted items affect totals)
  if (metadata.total && metadata.total > 0) {
    const itemSum = items.reduce((sum, i) => sum + i.price * (i.quantity ?? 1), 0);
    const ratio = itemSum / metadata.total;
    if (ratio < 0.5 || ratio > 2.0) {
      return {
        valid: false,
        reason: `item sum ($${itemSum.toFixed(2)}) is too far from total ($${metadata.total.toFixed(2)})`,
      };
    }
  }

  return { valid: true };
}

/**
 * Run the existing regex-based parsers as fallback.
 */
function regexFallback(
  text: string,
  html: string | undefined
): AIPasteParseResult {
  let parsed: ParsedPasteReceipt | undefined;

  // Try HTML first (preserves <li> structure from clipboard)
  if (html && html.length > 50) {
    parsed = parsePublixPasteHtml(html);
    if (parsed.items.length > 0) {
      return { ...parsed, parseMethod: "regex" };
    }
  }

  // Fall back to plain text
  parsed = parsePublixPasteReceipt(text);
  return { ...parsed, parseMethod: "regex" };
}
