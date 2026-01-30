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
    <div className="min-w-0 w-full" style={{ minHeight: 200 }}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          layout="vertical"
          data={barData}
          margin={{ top: 4, right: 8, bottom: 4, left: 4 }}
        >
          <CartesianGrid strokeDasharray="2 2" stroke="hsl(var(--border))" />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis
            type="category"
            dataKey="name"
            width={72}
            tick={{ fontSize: 11 }}
            stroke="hsl(var(--muted-foreground))"
            tickFormatter={(v) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)}
          />
          <Bar
            dataKey="count"
            fill="hsl(var(--primary) / 0.2)"
            radius={[0, 4, 4, 0]}
            maxBarSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
