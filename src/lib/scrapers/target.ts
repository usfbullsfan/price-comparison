/**
 * Target price scraper stub.
 *
 * Target has a public Redsky API used by their website.
 * We attempt to use it with the store ID for local pricing.
 *
 * Usage: run via POST /api/prices/scrape?store=TARGET
 */

export interface ScrapedPrice {
  price: number;
  salePrice?: number;
  onSale: boolean;
  url: string;
  imageUrl?: string;
  foundName?: string;
}

// Default Target store ID — override with nearest store's ID for local pricing
// Find your store ID: visit target.com, add to cart, the API calls will include store_id
const DEFAULT_STORE_ID = process.env.TARGET_STORE_ID ?? "1234";

/**
 * Search Target for a product using their Redsky API.
 */
export async function scrapeTargetPrice(
  query: string,
  _upc?: string
): Promise<ScrapedPrice | null> {
  try {
    // Target's search API (used by their website)
    const params = new URLSearchParams({
      q: query,
      pricing_store_id: DEFAULT_STORE_ID,
      key: "9f36aeafbe60771e321a7cc95a78140772ab3e96", // public key embedded in Target's website
      channel: "WEB",
      count: "1",
      offset: "0",
      default_purchasability_filter: "true",
    });

    const res = await fetch(
      `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?${params}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!res.ok) {
      console.warn(`Target scrape blocked: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const products = data?.data?.search?.products;
    if (!Array.isArray(products) || products.length === 0) return null;

    const first = products[0];
    const priceInfo = first?.price;
    const price =
      priceInfo?.current_retail ??
      priceInfo?.formatted_current_price_type === "sale"
        ? priceInfo?.reg_retail
        : priceInfo?.current_retail;

    const onSale = priceInfo?.formatted_current_price_type === "sale";
    const salePrice = onSale ? priceInfo?.current_retail : undefined;

    const tcin = first?.tcin;
    return {
      price: Number(price),
      salePrice: salePrice ? Number(salePrice) : undefined,
      onSale,
      url: `https://www.target.com/p/-/A-${tcin}`,
      imageUrl: first?.item?.enrichment?.images?.primary_image_url,
      foundName: first?.item?.product_description?.title,
    };
  } catch (err) {
    console.warn("Target scrape error:", err);
    return null;
  }
}
