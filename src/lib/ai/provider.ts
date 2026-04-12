/**
 * AI provider abstraction. Supports Claude and OpenAI with automatic
 * fallback: tries the configured preferred provider first, falls back
 * to the other if available.
 */

import type { ParsedLineItem } from "@/lib/normalize-product";

// ---- Types for AI-powered receipt parsing and product matching ----

export interface ReceiptParseContext {
  store?: string;
  source: "email" | "paste" | "devtools" | "ocr_fallback";
  format?: string; // e.g. "publix_pre", "publix_html", "json", "raw_text"
}

export interface ReceiptMetadata {
  purchaseDate?: string;
  total?: number;
  tax?: number;
  storeLocation?: string;
  store?: string;
}

export interface ProductAttributes {
  rawName: string;
  brand?: string;
  productType: string; // generic product: "butter", "deli turkey", "crackers"
  variety?: string; // "roasted", "naturally softer", "cheese"
  size?: string; // "8 oz", "12 ct"
  unit?: string; // "oz", "lb", "ct", "ea"
  unitSize?: number; // numeric: 8, 12
  category?: string; // "dairy", "deli", "snacks"
  isStoreGeneric?: boolean; // true for Publix, Great Value, Good & Gather, etc.
}

export interface CrossStoreMatch {
  candidateRawName: string;
  confidence: number; // 0-1
  matchReason: string;
}

// ---- AIProvider interface ----

export interface AIProvider {
  name: string;

  /** Parse a receipt image into structured line items */
  parseReceiptImage(
    imageBuffer: Buffer,
    mimeType: string
  ): Promise<{ items: ParsedLineItem[]; rawText: string }>;

  /** Match a messy receipt name to a clean product name */
  normalizeProductName(rawName: string, candidates?: string[]): Promise<string>;

  /** Batch normalize multiple product names at once (cheaper) */
  normalizeProductNames(
    rawNames: string[],
    candidates?: string[]
  ): Promise<Record<string, string>>;

  /** Parse any text-based receipt content into structured line items */
  parseReceiptText(
    text: string,
    context: ReceiptParseContext
  ): Promise<{ items: ParsedLineItem[]; metadata: ReceiptMetadata }>;

  /** Extract structured product attributes from raw receipt names */
  extractProductAttributes(
    rawNames: string[]
  ): Promise<ProductAttributes[]>;

  /** Find the best matching products across stores */
  matchProductsAcrossStores(
    sourceProduct: ProductAttributes,
    candidates: ProductAttributes[]
  ): Promise<CrossStoreMatch[]>;
}

let _provider: AIProvider | null = null;

/**
 * Provider priority: Gemini (free) → Claude → OpenAI.
 * Returns the first provider with a configured API key.
 * Returns null if no keys are set (regex-only mode).
 */
export function getAIProvider(): AIProvider | null {
  if (_provider) return _provider;

  // Lazy import to avoid bundling all SDKs
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (!hasGemini && !hasAnthropic && !hasOpenAI) return null;

  _provider = new LazyProvider(hasGemini, hasAnthropic, hasOpenAI);
  return _provider;
}

/**
 * Lazy provider that loads the actual implementation on first use.
 * This avoids importing heavy SDKs at module load time.
 *
 * Priority: Gemini (free tier) → Claude (best quality) → OpenAI
 */
class LazyProvider implements AIProvider {
  name = "lazy";
  private _inner: AIProvider | null = null;
  private _hasGemini: boolean;
  private _hasAnthropic: boolean;
  private _hasOpenAI: boolean;

  constructor(hasGemini: boolean, hasAnthropic: boolean, hasOpenAI: boolean) {
    this._hasGemini = hasGemini;
    this._hasAnthropic = hasAnthropic;
    this._hasOpenAI = hasOpenAI;
  }

  private async resolve(): Promise<AIProvider> {
    if (this._inner) return this._inner;

    if (this._hasGemini) {
      const { GeminiProvider } = await import("./gemini");
      this._inner = new GeminiProvider();
    } else if (this._hasAnthropic) {
      const { ClaudeProvider } = await import("./claude");
      this._inner = new ClaudeProvider();
    } else {
      const { OpenAIProvider } = await import("./openai");
      this._inner = new OpenAIProvider();
    }

    this.name = this._inner.name;
    return this._inner;
  }

  async parseReceiptImage(imageBuffer: Buffer, mimeType: string) {
    const p = await this.resolve();
    return p.parseReceiptImage(imageBuffer, mimeType);
  }

  async normalizeProductName(rawName: string, candidates?: string[]) {
    const p = await this.resolve();
    return p.normalizeProductName(rawName, candidates);
  }

  async normalizeProductNames(rawNames: string[], candidates?: string[]) {
    const p = await this.resolve();
    return p.normalizeProductNames(rawNames, candidates);
  }

  async parseReceiptText(text: string, context: ReceiptParseContext) {
    const p = await this.resolve();
    return p.parseReceiptText(text, context);
  }

  async extractProductAttributes(rawNames: string[]) {
    const p = await this.resolve();
    return p.extractProductAttributes(rawNames);
  }

  async matchProductsAcrossStores(
    sourceProduct: ProductAttributes,
    candidates: ProductAttributes[]
  ) {
    const p = await this.resolve();
    return p.matchProductsAcrossStores(sourceProduct, candidates);
  }
}
