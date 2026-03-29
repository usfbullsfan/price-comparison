"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PurgeReceiptsButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [purging, setPurging] = useState(false);

  async function handlePurge() {
    setPurging(true);
    try {
      const res = await fetch("/api/receipts", { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setPurging(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-600">Delete all receipts?</span>
        <button
          onClick={handlePurge}
          disabled={purging}
          className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
        >
          {purging ? "Purging..." : "Yes, purge all"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="px-3 py-1.5 bg-red-50 text-red-600 text-xs font-medium rounded-lg border border-red-200 hover:bg-red-100"
    >
      Purge All Receipts
    </button>
  );
}
