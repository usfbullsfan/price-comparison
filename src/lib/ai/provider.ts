/**
 * AI provider abstraction. Supports Claude and OpenAI with automatic
 * fallback: tries the configured preferred provider first, falls back
 * to the other if available.
 */

import type { ParsedLineItem } from "@/lib/normalize-product";

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
}

let _provider: AIProvider | null = null;

export function getAIProvider(): AIProvider | null {
  if (_provider) return _provider;

  // Lazy import to avoid bundling both SDKs
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (!hasAnthropic && !hasOpenAI) return null;

  // We'll resolve this synchronously by returning a lazy wrapper
  _provider = new LazyProvider(hasAnthropic, hasOpenAI);
  return _provider;
}

/**
 * Lazy provider that loads the actual implementation on first use.
 * This avoids importing heavy SDKs at module load time.
 */
class LazyProvider implements AIProvider {
  name = "lazy";
  private _inner: AIProvider | null = null;
  private _hasAnthropic: boolean;
  private _hasOpenAI: boolean;

  constructor(hasAnthropic: boolean, hasOpenAI: boolean) {
    this._hasAnthropic = hasAnthropic;
    this._hasOpenAI = hasOpenAI;
  }

  private async resolve(): Promise<AIProvider> {
    if (this._inner) return this._inner;

    if (this._hasAnthropic) {
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
}
