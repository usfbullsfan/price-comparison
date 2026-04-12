import { Product, Price, Store } from "@prisma/client";
import Link from "next/link";
import Image from "next/image";
import { formatPrice, latestPriceByStore, cheapestStore, storeLabel } from "@/lib/price-utils";

type ProductWithPrices = Product & { prices: Price[] };

export function ProductCard({ product }: { product: ProductWithPrices }) {
  const latest = latestPriceByStore(product.prices);
  const storesWithPrices = Object.entries(latest)
    .filter(([, p]) => !!p)
    .sort((a, b) => (a[1]?.price ?? 0) - (b[1]?.price ?? 0)) as [Store, Price][];

  const cheapest = cheapestStore(latest);
  const mostExpensive = storesWithPrices[storesWithPrices.length - 1];
  const savings =
    cheapest && mostExpensive && storesWithPrices.length >= 2
      ? mostExpensive[1].price - cheapest.price.price
      : null;

  return (
    <Link
      href={`/products/${product.id}`}
      className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-green-300 transition-all p-3"
    >
      <div className="flex items-start gap-3">
        {product.imageUrl && (
          <Image
            src={product.imageUrl}
            alt={product.name}
            width={64}
            height={64}
            className="w-16 h-16 rounded object-contain flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          {product.brand && (
            <p className="text-xs text-green-700 font-medium uppercase tracking-wide truncate">
              {product.brand}
            </p>
          )}
          <p className="font-semibold text-sm text-gray-900 line-clamp-2 mt-0.5">
            {product.name}
          </p>
          {product.size && (
            <p className="text-xs text-gray-400 mt-0.5">{product.size}</p>
          )}
        </div>
      </div>

      {/* Store prices row */}
      <div className="mt-2 flex items-end justify-between gap-2">
        {storesWithPrices.slice(0, 2).map(([store, price], i) => (
          <div key={store} className={i === 0 ? "" : "text-right"}>
            <p className="text-xs text-gray-400">{storeLabel(store)}</p>
            <p
              className={`font-bold ${
                i === 0 && storesWithPrices.length >= 2
                  ? "text-green-600"
                  : "text-gray-900"
              }`}
            >
              {formatPrice(price.price)}
            </p>
          </div>
        ))}

        {storesWithPrices.length === 1 && cheapest && (
          <div className="text-right">
            <p className="text-xs text-gray-400">Only store</p>
            <p className="font-bold text-gray-900">
              {formatPrice(cheapest.price.price)}
            </p>
          </div>
        )}

        {savings !== null && savings > 0.01 && (
          <span className="bg-green-600 text-white text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
            Save {formatPrice(savings)}
          </span>
        )}
      </div>
    </Link>
  );
}
