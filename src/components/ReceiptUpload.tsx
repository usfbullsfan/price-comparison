"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Store } from "@prisma/client";

type Tab = "image" | "devtools" | "email" | "paste";

const STORES = [
  { value: "PUBLIX", label: "Publix" },
  { value: "WALMART", label: "Walmart" },
  { value: "TARGET", label: "Target" },
];

export function ReceiptUpload() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("paste");
  const [store, setStore] = useState<string>("PUBLIX");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ itemCount?: number; saleCount?: number; receiptId?: string; error?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- Image upload ----
  async function handleImageUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setLoading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("store", store);

    try {
      const res = await fetch("/api/receipts/upload", {
        method: "POST",
        body: formData,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Upload failed");
      setResult({ receiptId: j.receiptId, itemCount: undefined });

      // Poll for completion
      pollStatus(j.receiptId);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setLoading(false);
    }
  }

  // ---- DevTools JSON ----
  async function handleDevToolsSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const json = (e.currentTarget.elements.namedItem("json") as HTMLTextAreaElement).value;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/receipts/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json, store }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Parse failed");
      setResult({ receiptId: j.receiptId, itemCount: j.itemCount });
      router.refresh();
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Parse failed" });
    } finally {
      setLoading(false);
    }
  }

  // ---- Website paste ----
  // contentEditable div shows formatted HTML; we also capture the raw
  // clipboard text/plain separately via onPaste so the backend gets
  // reliable plain text (with "You saved" lines intact for sale detection).
  const pasteRef = useRef<HTMLDivElement>(null);
  const [clipText, setClipText] = useState<string | null>(null);
  const [clipHtml, setClipHtml] = useState<string | null>(null);

  function handleClipboardPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (html) setClipHtml(html);
    if (text) setClipText(text);
  }

  async function handlePasteSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = pasteRef.current;
    if (!el) return;

    // Prefer captured clipboard text; fall back to contentEditable innerText
    const text = clipText || el.innerText;
    // Send both clipboard HTML and contentEditable innerHTML
    const html = clipHtml || el.innerHTML;

    if (!text || text.trim().length < 10) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/receipts/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, html, store }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Parse failed");
      setResult({ receiptId: j.receiptId, itemCount: j.itemCount, saleCount: j.saleCount });
      router.push(`/receipts/${j.receiptId}`);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Parse failed" });
    } finally {
      setLoading(false);
    }
  }

  async function pollStatus(receiptId: string) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/receipts/${receiptId}/status`);
        const data = await res.json();
        if (data.status === "DONE" || data.status === "NEEDS_REVIEW" || data.status === "FAILED") {
          setResult({ receiptId, itemCount: data._count?.lineItems });
          router.refresh();
          return;
        }
      } catch {}
    }
    setResult({ receiptId, error: "Parsing timed out — check receipts page" });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(["image", "paste", "devtools", "email"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t
                ? "text-green-700 border-b-2 border-green-700 bg-green-50"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "image" && "📸 Image"}
            {t === "paste" && "📋 Paste"}
            {t === "devtools" && "🔧 DevTools JSON"}
            {t === "email" && "✉️ Email Forwarding"}
          </button>
        ))}
      </div>

      <div className="p-6">
        {/* Store selector */}
        <div className="mb-4">
          <label className="text-sm font-medium text-gray-700 block mb-1">Store</label>
          <select
            value={store}
            onChange={(e) => setStore(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
          >
            {STORES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Image tab */}
        {tab === "image" && (
          <form onSubmit={handleImageUpload} className="space-y-4">
            <div
              className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-green-400 transition-colors cursor-pointer"
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={() => {}}
              />
              <p className="text-4xl mb-2">📸</p>
              <p className="text-sm font-medium text-gray-700">
                Click to select receipt image
              </p>
              <p className="text-xs text-gray-400 mt-1">
                PNG, JPG, WEBP — up to 20MB
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Uses Tesseract OCR by default (free). Set{" "}
                <code className="bg-gray-100 px-1 rounded">ANTHROPIC_API_KEY</code>{" "}
                for better accuracy.
              </p>
            </div>
            <SubmitButton loading={loading} label="Upload & Parse" />
          </form>
        )}

        {/* Paste tab */}
        {tab === "paste" && (
          <form onSubmit={handlePasteSubmit} className="space-y-4">
            <div className="bg-green-50 rounded-lg p-4 text-sm text-green-800">
              <p className="font-medium mb-1">How to capture from Publix website</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Go to your <strong>Publix purchase details</strong> page</li>
                <li>Press <kbd className="bg-white px-1 rounded border">Cmd+A</kbd> to select all</li>
                <li>Press <kbd className="bg-white px-1 rounded border">Cmd+C</kbd> to copy</li>
                <li>Paste below with <kbd className="bg-white px-1 rounded border">Cmd+V</kbd></li>
              </ol>
              <p className="text-xs text-green-600 mt-2">
                This captures full product names, sizes, and quantities — richer data than the email receipt.
              </p>
            </div>
            <div
              ref={pasteRef}
              contentEditable
              onPaste={handleClipboardPaste}
              data-placeholder={"Paste receipt content here (Cmd+V)"}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 min-h-[15rem] max-h-[30rem] overflow-y-auto empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400"
            />
            <SubmitButton loading={loading} label="Parse Pasted Text" />
          </form>
        )}

        {/* DevTools tab */}
        {tab === "devtools" && (
          <form onSubmit={handleDevToolsSubmit} className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
              <p className="font-medium mb-1">How to capture</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Open Chrome DevTools → Network tab</li>
                <li>Browse to your order history on the store&apos;s website</li>
                <li>Find the JSON request that returns order/cart items</li>
                <li>Right-click → Copy → <strong>Copy Response</strong></li>
                <li>Paste below</li>
              </ol>
            </div>
            <textarea
              name="json"
              required
              rows={10}
              placeholder='{"orderLines": [{"item": {"productName": "...", "price": 3.99}}, ...]}'
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <SubmitButton loading={loading} label="Parse JSON" />
          </form>
        )}

        {/* Email tab */}
        {tab === "email" && (
          <div className="space-y-4">
            <div className="bg-green-50 rounded-xl p-5 text-sm">
              <p className="font-semibold text-green-800 mb-2">Forward receipts via email</p>
              <p className="text-green-700 mb-3">
                Forward any Publix receipt email to:
              </p>
              <code className="block bg-white border border-green-200 rounded-lg px-4 py-3 text-base font-mono text-green-800 text-center">
                receipts@prices.wetpaws.dev
              </code>
              <p className="text-green-700 mt-3 text-xs">
                The email will be automatically parsed and products + prices added.
                Works best with Publix&apos;s HTML receipt emails.
              </p>
            </div>
            <div className="bg-amber-50 rounded-lg p-4 text-xs text-amber-800">
              <p className="font-medium mb-1">Setup required</p>
              <p>
                Configure an inbound route in your Resend dashboard pointing to{" "}
                <code className="bg-white px-1 rounded">
                  https://prices.wetpaws.dev/api/receipts/email
                </code>{" "}
                and add the webhook secret to <code className="bg-white px-1 rounded">RESEND_WEBHOOK_SECRET</code>.
              </p>
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div
            className={`mt-4 rounded-lg px-4 py-3 text-sm ${
              result.error
                ? "bg-red-50 text-red-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {result.error ? (
              <p>Error: {result.error}</p>
            ) : result.itemCount !== undefined ? (
              <p>
                ✓ Parsed {result.itemCount} item{result.itemCount !== 1 ? "s" : ""}
                {result.saleCount ? ` (${result.saleCount} on sale)` : ""}.{" "}
                <Link href={`/receipts/${result.receiptId}`} className="underline">View details</Link>
              </p>
            ) : (
              <p>Processing… check the{" "}
                <Link href="/receipts" className="underline">receipts page</Link> for status.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full py-2.5 bg-green-700 text-white font-medium rounded-lg hover:bg-green-800 disabled:opacity-50 transition-colors"
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Processing…
        </span>
      ) : (
        label
      )}
    </button>
  );
}
