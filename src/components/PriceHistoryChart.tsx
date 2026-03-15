"use client";

import { Price, Store } from "@prisma/client";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";

const STORE_COLORS: Record<Store, string> = {
  PUBLIX: "#15803d",
  WALMART: "#0071CE",
  TARGET: "#CC0000",
  OTHER: "#6b7280",
};

export function PriceHistoryChart({ prices }: { prices: Price[] }) {
  if (prices.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
        No price history yet
      </div>
    );
  }

  // Build chart data: one entry per date, columns per store
  type ChartEntry = { date: string } & Partial<Record<Store, number>>;
  const byDate = new Map<string, ChartEntry>();

  for (const p of [...prices].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )) {
    const key = format(new Date(p.date), "MM/dd/yy");
    if (!byDate.has(key)) byDate.set(key, { date: key });
    byDate.get(key)![p.store] = p.onSale && p.salePrice ? p.salePrice : p.price;
  }

  const data = Array.from(byDate.values());
  const activeStores = Array.from(new Set(prices.map((p) => p.store)));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis
          tickFormatter={(v) => `$${v.toFixed(2)}`}
          tick={{ fontSize: 11 }}
          width={52}
        />
        <Tooltip
          formatter={(value: number) => [`$${value.toFixed(2)}`, ""]}
        />
        <Legend />
        {activeStores.map((store) => (
          <Line
            key={store}
            type="monotone"
            dataKey={store}
            stroke={STORE_COLORS[store]}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
