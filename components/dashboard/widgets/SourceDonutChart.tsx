'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type { BreakdownItem } from '@/lib/hooks/use-dashboard-breakdown';

/** Light-theme palette (no dark assumptions). */
const CHART_COLORS = [
  'hsl(220 70% 50%)',
  'hsl(160 60% 45%)',
  'hsl(35 90% 55%)',
  'hsl(280 60% 55%)',
  'hsl(10 70% 55%)',
  'hsl(200 50% 50%)',
];

interface SourceDonutChartProps {
  items: BreakdownItem[];
  total: number;
}

export function SourceDonutChart({ items, total }: SourceDonutChartProps) {
  const pieData = useMemo(
    () =>
      items.map((item) => ({
        name: item.name,
        value: item.count,
      })),
    [items]
  );

  if (pieData.length === 0 || total === 0) return null;

  return (
    <div className="min-w-0 w-full h-[200px]">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={58}
            outerRadius={82}
            paddingAngle={1}
          >
            {pieData.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
                stroke="transparent"
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
