"use client";

import { useState } from "react";
import { Store } from "@prisma/client";
import { useRouter } from "next/navigation";

const STORES = [
  { value: Store.PUBLIX, label: "Publix" },
  { value: Store.WALMART, label: "Walmart" },
  { value: Store.TARGET, label: "Target" },
  { value: Store.OTHER, label: "Other" },
];

export function AddPriceForm({ productId }: { productId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleManualSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const form = e.currentTarget;
    const store = (form.elements.namedItem("store") as HTMLSelectElement).value;
    const price = parseFloat((form.elements.namedItem("price") as HTMLInputElement).value);
    const dateStr = (form.elements.namedItem("date") as HTMLInputElement).value;
    const onSale = (form.elements.namedItem("onSale") as HTMLInputElement).checked;
    const salePrice = parseFloat((form.elements.namedItem("salePrice") as HTMLInputElement).value);

    try {
      const res = await fetch("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          store,
          price,
          salePrice: onSale && salePrice ? salePrice : undefined,
          onSale,
          date: dateStr ? new Date(dateStr).toISOString() : undefined,
        }),
      });

      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? "Failed to add price");
      }

      setSuccess(true);
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleScrape(store: "WALMART" | "TARGET") {
    setScraping(true);
    setError(null);
    try {
      const res = await fetch("/api/prices/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, store }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Scrape failed");
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scrape failed");
    } finally {
      setScraping(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleManualSubmit} className="space-y-3">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Store</label>
          <select
            name="store"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            {STORES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Price *</label>
            <input
              name="price"
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="3.99"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Date</label>
            <input
              name="date"
              type="date"
              defaultValue={new Date().toISOString().split("T")[0]}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input name="onSale" type="checkbox" className="rounded" />
            On sale
          </label>
          <input
            name="salePrice"
            type="number"
            step="0.01"
            min="0"
            placeholder="Sale price"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
            Price added!
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 disabled:opacity-50"
        >
          {loading ? "Saving…" : "Add Price"}
        </button>
      </form>

      <div className="border-t border-gray-100 pt-4">
        <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">
          Auto-fetch competitor price
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => handleScrape("WALMART")}
            disabled={scraping}
            className="flex-1 py-2 text-sm font-medium rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {scraping ? "…" : "Fetch Walmart"}
          </button>
          <button
            onClick={() => handleScrape("TARGET")}
            disabled={scraping}
            className="flex-1 py-2 text-sm font-medium rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {scraping ? "…" : "Fetch Target"}
          </button>
        </div>
      </div>
    </div>
  );
}
