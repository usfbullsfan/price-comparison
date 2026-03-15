import { Product, Price, Store } from "@prisma/client";
import Link from "next/link";
import Image from "next/image";
import { formatPrice, latestPriceByStore } from "@/lib/price-utils";

type ProductWithPrices = Product & { prices: Price[] };

export function ProductCard({ product }: { product: ProductWithPrices }) {
  const latest = latestPriceByStore(product.prices);
  const publix = latest[Store.PUBLIX];
  const walmart = latest[Store.WALMART];
  const target = latest[Store.TARGET];

  const competitors = [walmart, target].filter(Boolean);
  const cheapest = competitors.sort((a, b) => (a?.price ?? 0) - (b?.price ?? 0))[0];
  const savings =
    publix && cheapest ? publix.price - cheapest.price : null;

  return (
    <Link
      href={`/products/${product.id}`}
      className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-green-300 transition-all overflow-hidden"
    >
      {/* Product image */}
      <div className="aspect-square bg-gray-50 relative overflow-hidden">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            className="object-contain p-4"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl text-gray-300">
            🛒
          </div>
        )}
        {savings !== null && savings > 0.01 && (
          <div className="absolute top-2 right-2 bg-green-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            Save {formatPrice(savings)}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="p-3">
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

        {/* Price row */}
        <div className="mt-2 flex items-end justify-between">
          <div>
            <p className="text-xs text-gray-400">Publix</p>
            <p className="font-bold text-gray-900">
              {publix ? formatPrice(publix.price) : "—"}
            </p>
          </div>

          {cheapest && (
            <div className="text-right">
              <p className="text-xs text-gray-400">
                {cheapest === walmart ? "Walmart" : "Target"}
              </p>
              <p
                className={`font-bold ${
                  savings && savings > 0
                    ? "text-green-600"
                    : savings && savings < 0
                    ? "text-red-500"
                    : "text-gray-900"
                }`}
              >
                {formatPrice(cheapest.price)}
              </p>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
