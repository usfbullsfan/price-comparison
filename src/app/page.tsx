import { prisma } from "@/lib/db";
import { ProductCard } from "@/components/ProductCard";
import Link from "next/link";

export const dynamic = "force-dynamic";

async function getProducts() {
  return prisma.product.findMany({
    include: {
      prices: {
        orderBy: { date: "desc" },
        take: 50, // enough to compute latest per store
      },
    },
    orderBy: { name: "asc" },
  });
}

export default async function DashboardPage() {
  const products = await getProducts();

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Price Tracker</h1>
          <p className="text-gray-500 mt-1">
            Compare Publix prices against Walmart &amp; Target
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/receipts/upload"
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 transition-colors"
          >
            <span>+</span> Add Receipt
          </Link>
          <Link
            href="/products/new"
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            + Add Product
          </Link>
        </div>
      </div>

      {products.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20">
      <div className="text-6xl mb-4">🛒</div>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">
        No products yet
      </h2>
      <p className="text-gray-500 mb-6 max-w-md mx-auto">
        Start by uploading a Publix receipt or forwarding a receipt email. Products
        and prices will be extracted automatically.
      </p>
      <div className="flex gap-3 justify-center">
        <Link
          href="/receipts/upload"
          className="px-6 py-3 bg-green-700 text-white font-medium rounded-lg hover:bg-green-800 transition-colors"
        >
          Upload Receipt
        </Link>
        <Link
          href="/receipts"
          className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          View Receipts
        </Link>
      </div>
    </div>
  );
}
