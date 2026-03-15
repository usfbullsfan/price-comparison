import { Price, Store } from "@prisma/client";
import { formatPrice } from "@/lib/price-utils";
import { format } from "date-fns";

const STORE_COLORS: Record<Store, string> = {
  PUBLIX: "text-green-700",
  WALMART: "text-blue-600",
  TARGET: "text-red-600",
  OTHER: "text-gray-600",
};

export function CompetitorPriceRow({ price }: { price: Price }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold uppercase ${STORE_COLORS[price.store]}`}>
          {price.store}
        </span>
        {price.onSale && (
          <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded-full font-medium">
            SALE
          </span>
        )}
      </div>
      <div className="text-right">
        <span className="font-semibold text-sm">
          {price.onSale && price.salePrice
            ? formatPrice(price.salePrice)
            : formatPrice(price.price)}
        </span>
        <span className="text-xs text-gray-400 ml-2">
          {format(new Date(price.date), "MM/dd/yy")}
        </span>
      </div>
    </div>
  );
}
