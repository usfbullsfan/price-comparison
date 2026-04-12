import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PriceHistoryChart } from "@/components/PriceHistoryChart";
import { CompetitorPriceRow } from "@/components/CompetitorPriceRow";
import { AddPriceForm } from "@/components/AddPriceForm";
import { Store, Price } from "@prisma/client";
import { formatPrice, latestPriceByStore, cheapestStore, storeLabel } from "@/lib/price-utils";
import Image from "next/image";
import Link from "next/link";

export const dynamic = "force-dynamic";

async function getProduct(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      prices: {
        orderBy: { date: "desc" },
        include: { receipt: { select: { id: true, source: true } } },
      },
      // Load canonical variants for cross-store comparison
      canonicalProduct: {
        include: {
          variants: {
            where: { id: { not: id } },
            include: {
              prices: {
                orderBy: { date: "desc" },
                take: 5,
              },
            },
          },
        },
      },
    },
  });
}

export default async function ProductPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const product = await getProduct(params.id);
  if (!product) notFound();

  // Collect prices from this product AND its canonical variants
  const allPrices: Price[] = [...product.prices];
  const variantNames: Record<string, string> = {};

  if (product.canonicalProduct?.variants) {
    for (const variant of product.canonicalProduct.variants) {
      for (const price of variant.prices) {
        allPrices.push(price);
      }
      variantNames[variant.id] = variant.name;
    }
  }

  const latest = latestPriceByStore(allPrices);
  const cheapest = cheapestStore(latest);

  // Sort stores by price (cheapest first)
  const storesWithPrices = (Object.entries(latest) as [Store, Price][])
    .filter(([, p]) => !!p)
    .sort((a, b) => a[1].price - b[1].price);

  const mostExpensive = storesWithPrices[storesWithPrices.length - 1];
  const maxSavings =
    cheapest && mostExpensive && storesWithPrices.length >= 2
      ? mostExpensive[1].price - cheapest.price.price
      : null;

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/"
        className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-block"
      >
        &larr; Back to products
      </Link>

      {/* Product header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex gap-6 items-start">
          {product.imageUrl && (
            <Image
              src={product.imageUrl}
              alt={product.name}
              width={120}
              height={120}
              className="rounded-lg object-contain border border-gray-100"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                {product.brand && (
                  <p className="text-sm font-medium text-green-700 uppercase tracking-wide">
                    {product.brand}
                  </p>
                )}
                <h1 className="text-2xl font-bold text-gray-900 mt-0.5">
                  {product.name}
                </h1>
                {product.size && (
                  <p className="text-gray-500 mt-1">{product.size}</p>
                )}
              </div>
              {maxSavings !== null && maxSavings > 0.01 && cheapest && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-center flex-shrink-0">
                  <p className="text-xs text-green-700 font-medium uppercase tracking-wide">
                    Cheapest at {storeLabel(cheapest.store)}
                  </p>
                  <p className="text-xl font-bold text-green-700">
                    Save {formatPrice(maxSavings)}
                  </p>
                </div>
              )}
            </div>

            {/* Price comparison row — all stores, cheapest highlighted */}
            <div className={`mt-4 grid gap-3 ${
              storesWithPrices.length <= 3
                ? `grid-cols-${Math.max(storesWithPrices.length, 3)}`
                : "grid-cols-4"
            }`}>
              {/* Always show all major stores even if no price */}
              {([Store.PUBLIX, Store.WALMART, Store.TARGET] as Store[]).map((store) => {
                const price = latest[store];
                const isCheapest = cheapest?.store === store && storesWithPrices.length >= 2;
                return (
                  <StorePrice
                    key={store}
                    label={storeLabel(store)}
                    price={price?.price}
                    unitPrice={price?.unitPrice}
                    onSale={price?.onSale}
                    saleType={price?.saleType}
                    highlight={isCheapest}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Cross-store variants */}
      {product.canonicalProduct?.variants && product.canonicalProduct.variants.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-3">Equivalent Products at Other Stores</h2>
          <div className="space-y-2">
            {product.canonicalProduct.variants.map((variant) => {
              const variantLatest = latestPriceByStore(variant.prices);
              const variantStores = Object.entries(variantLatest) as [Store, Price][];
              return (
                <Link
                  key={variant.id}
                  href={`/products/${variant.id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <div>
                    <p className="font-medium text-gray-900">{variant.name}</p>
                    {variant.size && (
                      <p className="text-xs text-gray-400">{variant.size}</p>
                    )}
                  </div>
                  <div className="flex gap-3">
                    {variantStores.map(([store, price]) => (
                      <div key={store} className="text-right">
                        <p className="text-xs text-gray-400">{storeLabel(store)}</p>
                        <p className="font-bold text-gray-900">
                          {formatPrice(price.price)}
                        </p>
                      </div>
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Price history chart */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Price History</h2>
        <PriceHistoryChart prices={product.prices} />
      </div>

      {/* Competitor prices + add form */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Prices</h2>
          <div className="space-y-2">
            {product.prices.slice(0, 10).map((p) => (
              <CompetitorPriceRow key={p.id} price={p} />
            ))}
            {product.prices.length === 0 && (
              <p className="text-sm text-gray-400 py-4 text-center">
                No price history yet
              </p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Add Price Manually</h2>
          <AddPriceForm productId={product.id} />
        </div>
      </div>
    </div>
  );
}

function StorePrice({
  label,
  price,
  unitPrice,
  onSale,
  saleType,
  highlight,
}: {
  label: string;
  price?: number;
  unitPrice?: number | null;
  onSale?: boolean;
  saleType?: string | null;
  highlight: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-3 border ${
        highlight
          ? "bg-green-50 border-green-300"
          : "bg-gray-50 border-gray-200"
      }`}
    >
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </p>
      {price !== undefined ? (
        <>
          <p
            className={`text-xl font-bold mt-1 ${
              highlight ? "text-green-700" : "text-gray-900"
            }`}
          >
            {formatPrice(price)}
            {onSale && (
              <span className={`ml-1 text-xs font-normal px-1.5 py-0.5 rounded-full ${
                saleType === "BOGO"
                  ? "text-purple-700 bg-purple-50"
                  : "text-orange-500 bg-orange-50"
              }`}>
                {saleType === "BOGO" ? "BOGO" : "SALE"}
              </span>
            )}
          </p>
          {unitPrice && (
            <p className="text-xs text-gray-400 mt-0.5">
              {formatPrice(unitPrice)}/unit
            </p>
          )}
        </>
      ) : (
        <p className="text-gray-400 mt-1 text-sm">--</p>
      )}
    </div>
  );
}
