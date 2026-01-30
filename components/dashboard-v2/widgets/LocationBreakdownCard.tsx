'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BreakdownItem } from '@/lib/hooks/use-dashboard-breakdown';
import { BreakdownBarRow } from './BreakdownBarRow';
import { ENABLE_CHARTS } from './charts-config';

const LocationBarChart = dynamic(
  () => import('./LocationBarChart').then((m) => ({ default: m.LocationBarChart })),
  { ssr: false }
);

interface LocationBreakdownCardProps {
  items: BreakdownItem[];
  total: number;
}

export function LocationBreakdownCard({ items, total }: LocationBreakdownCardProps) {
  return (
    <Card className="border-border bg-card" data-testid="p4-location-card">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base font-semibold">Locations</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3 min-w-0">
        {ENABLE_CHARTS && items.length > 0 && (
          <div className="min-w-0">
            <LocationBarChart items={items} topN={8} />
          </div>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No locations in range</p>
        ) : (
          items.map((item) => (
            <BreakdownBarRow
              key={item.name}
              item={item}
              total={total}
              decodeLabel
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
