'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BreakdownItem } from '@/lib/hooks/use-dashboard-breakdown';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { BreakdownBarRow } from './breakdown-bar-row';
import { ENABLE_CHARTS } from './charts-config';

const SourceDonutChart = dynamic(
  () => import('./source-donut-chart').then((m) => ({ default: m.SourceDonutChart })),
  { ssr: false }
);

interface SourceBreakdownCardProps {
  items: BreakdownItem[];
  total: number;
}

export function SourceBreakdownCard({ items, total }: SourceBreakdownCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="border border-slate-200 bg-white shadow-sm" data-testid="p4-source-card">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="text-base font-semibold text-slate-800">{t('breakdown.sources')}</CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-0 space-y-4 min-w-0">
        {ENABLE_CHARTS && items.length > 0 && total > 0 && (
          <div className="min-w-0 rounded-lg bg-slate-50/80 p-3">
            <SourceDonutChart items={items} total={total} />
          </div>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">{t('breakdown.noSourcesInRange')}</p>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => (
              <BreakdownBarRow key={item.name} item={item} total={total} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
