'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BreakdownItem } from '@/lib/hooks/use-dashboard-breakdown';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { BreakdownBarRow } from './breakdown-bar-row';

interface DeviceBreakdownCardProps {
  items: BreakdownItem[];
  total: number;
}

export function DeviceBreakdownCard({ items, total }: DeviceBreakdownCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="border border-slate-200 bg-white shadow-sm" data-testid="p4-device-card">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="text-base font-semibold text-slate-800">{t('breakdown.devices')}</CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-0 space-y-2.5">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">{t('breakdown.noDevicesInRange')}</p>
        ) : (
          items.map((item) => (
            <BreakdownBarRow key={item.name} item={item} total={total} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
