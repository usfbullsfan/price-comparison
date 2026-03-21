"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface LineItem {
  id: string;
  rawName: string;
  price: number;
  salePrice: number | null;
  quantity: number;
  weight: number | null;
  onSale: boolean;
  saleType: string | null;
}

interface EditState {
  rawName: string;
  price: string;
  salePrice: string;
  quantity: string;
  weight: string;
}

export function ReceiptDetail({
  receiptId,
  items: initialItems,
}: {
  receiptId: string;
  items: LineItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    rawName: "",
    price: "",
    salePrice: "",
    quantity: "",
    weight: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function startEdit(item: LineItem) {
    setEditingId(item.id);
    setEditState({
      rawName: item.rawName,
      price: item.price.toFixed(2),
      salePrice: item.salePrice?.toFixed(2) ?? "",
      quantity: String(item.quantity),
      weight: item.weight?.toString() ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(itemId: string) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        rawName: editState.rawName,
        price: parseFloat(editState.price),
        quantity: parseInt(editState.quantity, 10) || 1,
      };
      if (editState.salePrice) {
        body.salePrice = parseFloat(editState.salePrice);
        body.onSale = true;
      } else {
        body.salePrice = null;
        body.onSale = false;
      }
      if (editState.weight) {
        body.weight = parseFloat(editState.weight);
      } else {
        body.weight = null;
      }

      const res = await fetch(`/api/receipts/${receiptId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");

      const updated = await res.json();
      setItems((prev) =>
        prev.map((it) => (it.id === itemId ? { ...it, ...updated } : it))
      );
      setEditingId(null);
    } catch {
      alert("Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(itemId: string) {
    if (!confirm("Remove this item from the receipt?")) return;
    try {
      const res = await fetch(`/api/receipts/${receiptId}/items/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setItems((prev) => prev.filter((it) => it.id !== itemId));
    } catch {
      alert("Failed to delete item");
    }
  }

  async function deleteReceipt() {
    if (!confirm("Delete this entire receipt and all its items? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/receipts/${receiptId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      // Hard navigation to bypass Next.js client-side cache
      window.location.href = "/receipts";
    } catch {
      alert("Failed to delete receipt");
      setDeleting(false);
    }
  }

  const totalPaid = items.reduce((sum, it) => {
    const unitPrice = it.onSale && it.salePrice != null ? it.salePrice : it.price;
    return sum + unitPrice * it.quantity;
  }, 0);

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Item</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600 w-16">Qty</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600 w-24">Unit Price</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600 w-24">Sale</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600 w-20">Weight</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600 w-24">Total</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item) =>
              editingId === item.id ? (
                <tr key={item.id} className="bg-yellow-50">
                  <td className="px-4 py-2">
                    <input
                      value={editState.rawName}
                      onChange={(e) => setEditState((s) => ({ ...s, rawName: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={editState.quantity}
                      onChange={(e) => setEditState((s) => ({ ...s, quantity: e.target.value }))}
                      className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                      type="number"
                      min="1"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={editState.price}
                      onChange={(e) => setEditState((s) => ({ ...s, price: e.target.value }))}
                      className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                      type="number"
                      step="0.01"
                      min="0"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={editState.salePrice}
                      onChange={(e) => setEditState((s) => ({ ...s, salePrice: e.target.value }))}
                      className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                      type="number"
                      step="0.01"
                      placeholder="—"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={editState.weight}
                      onChange={(e) => setEditState((s) => ({ ...s, weight: e.target.value }))}
                      className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                      type="number"
                      step="0.01"
                      placeholder="lb"
                    />
                  </td>
                  <td className="px-4 py-2 text-right text-gray-400 text-xs">—</td>
                  <td className="px-4 py-2 text-right space-x-1">
                    <button
                      onClick={() => saveEdit(item.id)}
                      disabled={saving}
                      className="text-xs px-2 py-1 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
                    >
                      {saving ? "..." : "Save"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="font-medium">{item.rawName}</span>
                    {item.saleType && (
                      <span
                        className={`ml-2 px-1.5 py-0.5 rounded text-xs font-medium ${
                          item.saleType === "BOGO"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-orange-100 text-orange-700"
                        }`}
                      >
                        {item.saleType}
                      </span>
                    )}
                    {item.onSale && !item.saleType && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                        SALE
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{item.quantity}</td>
                  <td className="px-4 py-3 text-right">
                    {item.onSale ? (
                      <span className="text-gray-400 line-through">${item.price.toFixed(2)}</span>
                    ) : (
                      <span>${item.price.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.salePrice != null ? (
                      <span className="text-green-700 font-medium">${item.salePrice.toFixed(2)}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {item.weight != null ? `${item.weight} lb` : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    ${((item.onSale && item.salePrice != null ? item.salePrice : item.price) * item.quantity).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button
                      onClick={() => startEdit(item)}
                      className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="text-xs px-2 py-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50">
            <tr>
              <td className="px-4 py-3 font-medium" colSpan={5}>
                Total ({items.length} items)
              </td>
              <td className="px-4 py-3 text-right font-bold">
                ${totalPaid.toFixed(2)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={deleteReceipt}
          disabled={deleting}
          className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? "Deleting..." : "Delete Entire Receipt"}
        </button>
      </div>
    </div>
  );
}
