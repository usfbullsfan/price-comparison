import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PriceHistoryChart } from "@/components/PriceHistoryChart";
import { CompetitorPriceRow } from "@/components/CompetitorPriceRow";
import { AddPriceForm } from "@/components/AddPriceForm";
import { Store } from "@prisma/client";
import { formatPrice, latestPriceByStore } from "@/lib/price-utils";
import Image from "next/image";
import Link from "next/link";

export const revalidate = 60;

async function getProduct(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      prices: {
        orderBy: { date: "desc" },
        include: { receipt: { select: { id: true, source: true } } },
      },
    },
  });
}

export default async function ProductPage({
  params,
}: {
  params: { id: string };
}) {
  const product = await getProduct(params.id);
  if (!product) notFound();

  const latest = latestPriceByStore(product.prices);
  const publixPrice = latest[Store.PUBLIX];
  const walmartPrice = latest[Store.WALMART];
  const targetPrice = latest[Store.TARGET];

  const cheapestCompetitor = [walmartPrice, targetPrice]
    .filter(Boolean)
    .sort((a, b) => (a?.price ?? 0) - (b?.price ?? 0))[0];

  const savings =
    publixPrice && cheapestCompetitor
      ? publixPrice.price - cheapestCompetitor.price
      : null;

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/"
        className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-block"
      >
        ← Back to products
      </Link>

      {/* Product header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex gap-6 items-start">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              width={120}
              height={120}
              className="rounded-lg object-contain border border-gray-100"
            />
          ) : (
            <div className="w-28 h-28 rounded-lg bg-gray-100 flex items-center justify-center text-4xl flex-shrink-0">
              🛒
            </div>
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
              {savings !== null && savings > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-center flex-shrink-0">
                  <p className="text-xs text-green-700 font-medium uppercase tracking-wide">
                    Save at competitor
                  </p>
                  <p className="text-xl font-bold text-green-700">
                    {formatPrice(savings)}
                  </p>
                </div>
              )}
            </div>

            {/* Price comparison row */}
            <div className="mt-4 grid grid-cols-3 gap-3">
              <StorePrice
                label="Publix"
                price={publixPrice?.price}
                unitPrice={publixPrice?.unitPrice}
                onSale={publixPrice?.onSale}
                highlight={false}
              />
              <StorePrice
                label="Walmart"
                price={walmartPrice?.price}
                unitPrice={walmartPrice?.unitPrice}
                onSale={walmartPrice?.onSale}
                highlight={
                  !!walmartPrice &&
                  !!publixPrice &&
                  walmartPrice.price < publixPrice.price
                }
              />
              <StorePrice
                label="Target"
                price={targetPrice?.price}
                unitPrice={targetPrice?.unitPrice}
                onSale={targetPrice?.onSale}
                highlight={
                  !!targetPrice &&
                  !!publixPrice &&
                  targetPrice.price < publixPrice.price
                }
              />
            </div>
          </div>
        </div>
      </div>

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
  highlight,
}: {
  label: string;
  price?: number;
  unitPrice?: number | null;
  onSale?: boolean;
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
              <span className="ml-1 text-xs font-normal text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full">
                SALE
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
        <p className="text-gray-400 mt-1 text-sm">—</p>
      )}
    </div>
  );
}
