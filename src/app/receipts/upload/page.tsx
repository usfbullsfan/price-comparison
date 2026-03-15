import { ReceiptUpload } from "@/components/ReceiptUpload";
import Link from "next/link";

export default function UploadPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/receipts" className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-block">
        ← Back to receipts
      </Link>
      <h1 className="text-2xl font-bold mb-2">Add Receipt</h1>
      <p className="text-gray-500 mb-6">
        Upload a receipt image, paste DevTools JSON from a store&apos;s website, or
        forward a receipt email to{" "}
        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">receipts@prices.wetpaws.dev</code>.
      </p>
      <ReceiptUpload />
    </div>
  );
}
