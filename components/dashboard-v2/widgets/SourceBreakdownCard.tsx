'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BreakdownItem } from '@/lib/hooks/use-dashboard-breakdown';
import { BreakdownBarRow } from './BreakdownBarRow';
import { ENABLE_CHARTS } from './charts-config';

const SourceDonutChart = dynamic(
  () => import('./SourceDonutChart').then((m) => ({ default: m.SourceDonutChart })),
  { ssr: false }
);

interface SourceBreakdownCardProps {
  items: BreakdownItem[];
  total: number;
}

export function SourceBreakdownCard({ items, total }: SourceBreakdownCardProps) {
  return (
    <Card className="border-border bg-card" data-testid="p4-source-card">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base font-semibold">Sources</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3 min-w-0">
        {ENABLE_CHARTS && items.length > 0 && total > 0 && (
          <div className="min-w-0">
            <SourceDonutChart items={items} total={total} />
          </div>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sources in range</p>
        ) : (
          items.map((item) => (
            <BreakdownBarRow key={item.name} item={item} total={total} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
