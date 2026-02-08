'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboardBreakdown } from '@/lib/hooks/use-dashboard-breakdown';
import { strings } from '@/lib/i18n/en';
import { SourceBreakdownCard } from './source-breakdown-card';
import { LocationBreakdownCard } from './location-breakdown-card';
import { DeviceBreakdownCard } from './device-breakdown-card';

export interface BreakdownWidgetsProps {
  siteId: string;
  dateRange: { from: string; to: string };
  adsOnly: boolean;
}

export function BreakdownWidgets({ siteId, dateRange, adsOnly }: BreakdownWidgetsProps) {
  const { data, isLoading, error, refetch } = useDashboardBreakdown(
    siteId,
    { from: dateRange.from, to: dateRange.to },
    adsOnly
  );

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="p4-breakdown">
        <h2 className="text-base font-semibold text-slate-800">{strings.breakdown}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-w-0">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-border bg-card">
              <CardHeader className="p-4 pb-2">
                <Skeleton className="h-5 w-24" />
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3" data-testid="p4-breakdown">
        <h2 className="text-sm font-semibold">Breakdown</h2>
        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetch()}
              data-testid="breakdown-retry"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const total = data?.total_sessions ?? 0;
  const sources = data?.sources ?? [];
  const locations = data?.locations ?? [];
  const devices = data?.devices ?? [];
  const isEmpty =
    total === 0 ||
    (sources.length === 0 && locations.length === 0 && devices.length === 0);

  if (isEmpty) {
    return (
      <div className="space-y-4" data-testid="p4-breakdown">
        <h2 className="text-base font-semibold text-slate-800">{strings.breakdown}</h2>
        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{strings.noDataInRange}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-w-0" data-testid="p4-breakdown">
      <div>
        <h2 className="text-base font-semibold text-slate-800">{strings.breakdown}</h2>
        <p className="text-xs text-slate-500 uppercase tracking-wider mt-1">{strings.breakdownSubtitle}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-w-0">
        <div className="min-w-0">
          <SourceBreakdownCard items={sources} total={total} />
        </div>
        <div className="min-w-0">
          <LocationBreakdownCard items={locations} total={total} />
        </div>
        <div className="min-w-0">
          <DeviceBreakdownCard items={devices} total={total} />
        </div>
      </div>
    </div>
  );
}
