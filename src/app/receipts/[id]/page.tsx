import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { ReceiptDetail } from "@/components/ReceiptDetail";

export const dynamic = "force-dynamic";

export default async function ReceiptDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: params.id },
    include: {
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!receipt) notFound();

  const dateLabel = receipt.purchaseDate
    ? format(receipt.purchaseDate, "MMMM d, yyyy")
    : format(receipt.createdAt, "MMMM d, yyyy");

  return (
    <div>
      <div className="mb-6">
        <Link href="/receipts" className="text-sm text-green-700 hover:underline">
          &larr; Back to receipts
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{receipt.store} Receipt</h1>
          <p className="text-sm text-gray-500 mt-1">{dateLabel}</p>
          {receipt.total != null && (
            <p className="text-sm text-gray-500">
              Total: ${receipt.total.toFixed(2)}
            </p>
          )}
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            receipt.status === "DONE"
              ? "bg-green-100 text-green-700"
              : receipt.status === "FAILED"
              ? "bg-red-100 text-red-700"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {receipt.status}
        </span>
      </div>

      <ReceiptDetail
        receiptId={receipt.id}
        items={receipt.lineItems.map((li) => ({
          id: li.id,
          rawName: li.rawName,
          price: li.price,
          salePrice: li.salePrice,
          quantity: li.quantity,
          weight: li.weight,
          onSale: li.onSale,
          saleType: li.saleType,
        }))}
      />
    </div>
  );
}
