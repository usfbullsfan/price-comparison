import { prisma } from "@/lib/db";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { ParseStatus, ReceiptSource, Store } from "@prisma/client";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<ReceiptSource, string> = {
  EMAIL: "Email",
  IMAGE_UPLOAD: "Image Upload",
  DEVTOOLS_JSON: "DevTools JSON",
  MANUAL: "Manual",
  WEBSITE_PASTE: "Website Paste",
};

const STATUS_STYLES: Record<ParseStatus, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  PROCESSING: "bg-blue-100 text-blue-700",
  DONE: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  NEEDS_REVIEW: "bg-orange-100 text-orange-700",
};

export default async function ReceiptsPage() {
  const receipts = await prisma.receipt.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { lineItems: true } },
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Receipts</h1>
        <Link
          href="/receipts/upload"
          className="px-4 py-2 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800"
        >
          + Upload Receipt
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {receipts.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-4xl mb-3">🧾</p>
            <p className="font-medium">No receipts yet</p>
            <p className="text-sm mt-1">
              Upload a receipt image, forward an email, or paste DevTools JSON
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Store</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Items</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Total</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receipts.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/receipts/${r.id}`} className="text-green-700 hover:underline">
                      {r.store}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{SOURCE_LABELS[r.source]}</td>
                  <td className="px-4 py-3">{r._count.lineItems}</td>
                  <td className="px-4 py-3">
                    {r.total != null ? `$${r.total.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {r.purchaseDate
                      ? format(r.purchaseDate, "MMM d, yyyy")
                      : formatDistanceToNow(r.createdAt, { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
