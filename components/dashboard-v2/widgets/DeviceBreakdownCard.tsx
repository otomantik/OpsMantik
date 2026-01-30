'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BreakdownItem } from '@/lib/hooks/use-dashboard-breakdown';
import { BreakdownBarRow } from './BreakdownBarRow';

interface DeviceBreakdownCardProps {
  items: BreakdownItem[];
  total: number;
}

export function DeviceBreakdownCard({ items, total }: DeviceBreakdownCardProps) {
  return (
    <Card className="border-border bg-card" data-testid="p4-device-card">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base font-semibold">Devices</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No devices in range</p>
        ) : (
          items.map((item) => (
            <BreakdownBarRow key={item.name} item={item} total={total} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
