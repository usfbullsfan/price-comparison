"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewProductPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const data = {
      name: (form.elements.namedItem("name") as HTMLInputElement).value,
      brand: (form.elements.namedItem("brand") as HTMLInputElement).value || undefined,
      size: (form.elements.namedItem("size") as HTMLInputElement).value || undefined,
      unit: (form.elements.namedItem("unit") as HTMLInputElement).value || undefined,
      unitSize: parseFloat((form.elements.namedItem("unitSize") as HTMLInputElement).value) || undefined,
      upc: (form.elements.namedItem("upc") as HTMLInputElement).value || undefined,
      category: (form.elements.namedItem("category") as HTMLInputElement).value || undefined,
    };

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? "Failed to create product");
      }
      const product = await res.json();
      router.push(`/products/${product.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Add Product</h1>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Product Name *" name="name" required placeholder="e.g. Organic Whole Milk" />
          <Field label="Brand" name="brand" placeholder="e.g. Publix GreenWise" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Size" name="size" placeholder="e.g. 32 oz" />
            <Field label="Unit" name="unit" placeholder="e.g. oz, lb, ct" />
          </div>
          <Field label="Unit Size (number)" name="unitSize" type="number" placeholder="e.g. 32" />
          <Field label="UPC Barcode" name="upc" placeholder="12-digit barcode" />
          <Field label="Category" name="category" placeholder="e.g. Dairy, Produce" />

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-green-700 text-white font-medium rounded-lg hover:bg-green-800 disabled:opacity-50 transition-colors"
          >
            {loading ? "Saving…" : "Save Product"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
      />
    </label>
  );
}
