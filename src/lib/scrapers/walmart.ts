/**
 * Walmart price scraper stub.
 *
 * Walmart has a public API endpoint used by their website that returns
 * product data as JSON. This is a best-effort approach — Walmart may
 * block automated requests. Consider using a proxy (SCRAPER_PROXY_URL) if blocked.
 *
 * Usage: run via POST /api/prices/scrape?store=WALMART
 */

export interface ScrapedPrice {
  price: number;
  salePrice?: number;
  onSale: boolean;
  url: string;
  imageUrl?: string;
  foundName?: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Search Walmart for a product by name or UPC and return the best-match price.
 * Returns null if not found or if scraping is blocked.
 */
export async function scrapeWalmartPrice(
  query: string,
  upc?: string
): Promise<ScrapedPrice | null> {
  const searchTerm = upc ?? query;
  const searchUrl = `https://www.walmart.com/search?q=${encodeURIComponent(searchTerm)}&affinityOverride=default`;

  const proxyUrl = process.env.SCRAPER_PROXY_URL;
  const fetchUrl = proxyUrl
    ? `${proxyUrl}?url=${encodeURIComponent(searchUrl)}`
    : searchUrl;

  try {
    const res = await fetch(fetchUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`Walmart scrape blocked: ${res.status}`);
      return null;
    }

    const html = await res.text();

    // Walmart embeds product data in a __NEXT_DATA__ script tag
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
    if (!match) return null;

    const nextData = JSON.parse(match[1]);
    const items =
      nextData?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]
        ?.items;

    if (!Array.isArray(items) || items.length === 0) return null;

    const first = items[0];
    const price = first?.price ?? first?.priceInfo?.currentPrice?.price;
    const wasPrice = first?.priceInfo?.wasPrice?.price;
    const onSale = !!wasPrice && wasPrice > price;

    return {
      price: Number(price),
      salePrice: onSale ? Number(price) : undefined,
      onSale,
      url: `https://www.walmart.com${first?.canonicalUrl ?? ""}`,
      imageUrl: first?.imageInfo?.thumbnailUrl,
      foundName: first?.name,
    };
  } catch (err) {
    console.warn("Walmart scrape error:", err);
    return null;
  }
}

/**
 * Search Walmart by UPC using their product lookup endpoint.
 * This is more reliable than HTML scraping for UPC-based lookups.
 */
export async function lookupWalmartByUpc(upc: string): Promise<ScrapedPrice | null> {
  try {
    const res = await fetch(
      `https://www.walmart.com/ip/${upc}`,
      {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!res.ok) return null;
    const html = await res.text();

    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
    if (!match) return null;

    const nextData = JSON.parse(match[1]);
    const product = nextData?.props?.pageProps?.initialData?.data?.product;
    if (!product) return null;

    const price = product?.priceInfo?.currentPrice?.price;
    const wasPrice = product?.priceInfo?.wasPrice?.price;
    const onSale = !!wasPrice && wasPrice > price;

    return {
      price: Number(price),
      salePrice: onSale ? Number(price) : undefined,
      onSale,
      url: `https://www.walmart.com/ip/${product.usItemId}`,
      imageUrl: product?.imageInfo?.thumbnailUrl,
      foundName: product?.name,
    };
  } catch {
    return null;
  }
}
