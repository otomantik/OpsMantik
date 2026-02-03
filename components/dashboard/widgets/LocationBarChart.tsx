'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

interface LocationBarChartProps {
  items: { name: string; count: number; pct: number }[];
  /** Top N (default 8). */
  topN?: number;
}

export function LocationBarChart({ items, topN = 8 }: LocationBarChartProps) {
  const barData = useMemo(
    () =>
      items
        .slice(0, topN)
        .map((item) => ({
          name: safeDecode(item.name),
          count: item.count,
        })),
    [items, topN]
  );

  if (barData.length === 0) return null;

  return (
    <div className="min-w-0 w-full h-[280px]">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          layout="vertical"
          data={barData}
          margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
        >
          <CartesianGrid strokeDasharray="2 2" stroke="#e2e8f0" vertical={false} />
          <XAxis type="number" tick={{ fontSize: 12 }} stroke="#64748b" />
          <YAxis
            type="category"
            dataKey="name"
            width={100}
            tick={{ fontSize: 12 }}
            stroke="#64748b"
            tickFormatter={(v) => (typeof v === 'string' && v.length > 18 ? `${v.slice(0, 17)}…` : v)}
          />
          <Bar
            dataKey="count"
            fill="#3b82f6"
            radius={[0, 6, 6, 0]}
            maxBarSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
