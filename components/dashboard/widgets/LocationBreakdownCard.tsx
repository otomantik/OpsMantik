'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BreakdownItem } from '@/lib/hooks/use-dashboard-breakdown';
import { strings } from '@/lib/i18n/en';
import { BreakdownBarRow } from './BreakdownBarRow';
import { ENABLE_CHARTS } from './charts-config';

const LocationBarChart = dynamic(
  () => import('./LocationBarChart').then((m) => ({ default: m.LocationBarChart })),
  { ssr: false }
);

const TOP_LIST = 8;
const LIST_MAX_HEIGHT = 220;

interface LocationBreakdownCardProps {
  items: BreakdownItem[];
  total: number;
}

export function LocationBreakdownCard({ items, total }: LocationBreakdownCardProps) {
  const showItems = items.slice(0, TOP_LIST);
  const restCount = items.length > TOP_LIST ? items.length - TOP_LIST : 0;

  return (
    <Card className="border border-slate-200 bg-white shadow-sm" data-testid="p4-location-card">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="text-base font-semibold text-slate-800">{strings.locations}</CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-0 space-y-4 min-w-0">
        {ENABLE_CHARTS && items.length > 0 && (
          <div className="min-w-0 rounded-lg bg-slate-50/80 p-3">
            <LocationBarChart items={items} topN={8} />
          </div>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">{strings.noLocationsInRange}</p>
        ) : (
          <div className="space-y-2.5 overflow-y-auto pr-1" style={{ maxHeight: LIST_MAX_HEIGHT }}>
            {showItems.map((item) => (
              <BreakdownBarRow
                key={item.name}
                item={item}
                total={total}
                decodeLabel
              />
            ))}
            {restCount > 0 && (
              <p className="text-xs text-slate-400 pt-1 border-t border-slate-100 mt-2">
                {strings.otherLocations(restCount)}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
