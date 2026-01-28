'use client';

import { useDashboardStats } from '@/lib/hooks/use-dashboard-stats';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';
import { Icons } from '@/components/icons';
import { useMemo } from 'react';

interface KPICardsV2Props {
  siteId: string;
}

function KpiLabel({
  label,
  tooltip,
  rightSlot,
}: {
  label: string;
  tooltip: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="text-sm text-muted-foreground uppercase tracking-wider">{label}</div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                aria-label={`${label} tooltip`}
              >
                <Icons.info className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="w-[280px]">
              <div className="text-sm">{tooltip}</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {rightSlot}
    </div>
  );
}

export function KPICardsV2({ siteId }: KPICardsV2Props) {
  // Always use TODAY range for Command Center
  const dateRange = useMemo(() => {
    const { fromIso, toIso } = getTodayTrtUtcRange();
    return { from: new Date(fromIso), to: new Date(toIso) };
  }, []);

  const { stats, loading, error, refetch } = useDashboardStats(siteId, dateRange);

  // Realtime updates for optimistic KPI refresh
  useRealtimeDashboard(
    siteId,
    {
      onEventCreated: () => {
        refetch();
      },
      onCallCreated: () => {
        refetch();
      },
      onDataFreshness: () => {
        refetch();
      },
    },
    { adsOnly: true }
  );

  if (error) {
    return (
      <Card className="border border-rose-200 bg-rose-50">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <Icons.alert className="w-10 h-10 text-rose-600 mb-2" />
          <p className="text-rose-800 text-sm mb-4">Critical failure: {error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="bg-background border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            <Icons.refresh className="w-3 h-3 mr-2" />
            Retry Connection
          </Button>
        </CardContent>
      </Card>
    );
  }

  const adsSessions = loading ? null : (stats?.ads_sessions ?? 0);
  const phoneIntents = loading ? null : (stats?.phone_click_intents ?? 0);
  const whatsappIntents = loading ? null : (stats?.whatsapp_click_intents ?? 0);
  const sealed = loading ? null : (stats?.sealed ?? 0);

  const formsEnabled = Boolean(stats?.forms_enabled);
  const forms = loading ? null : (stats?.forms ?? 0);

  const hasNoActivity =
    !loading &&
    !!stats &&
    (adsSessions ?? 0) === 0 &&
    (phoneIntents ?? 0) === 0 &&
    (whatsappIntents ?? 0) === 0 &&
    (sealed ?? 0) === 0 &&
    (stats.total_events || 0) === 0;

  const fmt = (n: number | null) => (n === null ? '…' : n.toLocaleString());

  return (
    <div className="space-y-4">
      {/* No Activity Helper */}
      {hasNoActivity && (
        <div className="px-4 py-2 bg-muted border border-border rounded-lg">
          <p className="text-sm text-muted-foreground text-center">
            No activity yet • Send events from your site to see metrics here
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Ads Sessions */}
        <Card className="bg-background text-foreground border border-border shadow-sm">
          <CardContent className="p-4">
            <KpiLabel
              label="Ads Sessions"
              tooltip="Unique Ads-attributed sessions today (TRT timezone). Ads-only filter applied."
              rightSlot={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => refetch()}
                  title="Refresh KPIs"
                >
                  <Icons.refresh className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              }
            />
            <div className="mt-3 text-[2.5rem] leading-none font-bold tabular-nums">
              {loading ? <Skeleton className="h-10 w-24" /> : fmt(adsSessions)}
            </div>
            <div className="mt-2 inline-flex items-center rounded-full border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
              Sessions
            </div>
          </CardContent>
        </Card>

        {/* Phone Click Intents */}
        <Card className="bg-background text-foreground border border-border shadow-sm">
          <CardContent className="p-4">
            <KpiLabel
              label="Phone Intents"
              tooltip="Phone click intents matched to Ads sessions today."
            />
            <div className="mt-3 text-[2.5rem] leading-none font-bold tabular-nums">
              {loading ? <Skeleton className="h-10 w-24" /> : fmt(phoneIntents)}
            </div>
            <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">
              <Icons.phone className="w-3 h-3" />
              Click
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp Click Intents */}
        <Card className="bg-background text-foreground border border-border shadow-sm">
          <CardContent className="p-4">
            <KpiLabel
              label="WhatsApp Intents"
              tooltip="WhatsApp click intents matched to Ads sessions today."
            />
            <div className="mt-3 text-[2.5rem] leading-none font-bold tabular-nums">
              {loading ? <Skeleton className="h-10 w-24" /> : fmt(whatsappIntents)}
            </div>
            <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700">
              <Icons.whatsappBrand className="w-3 h-3" />
              Click
            </div>
          </CardContent>
        </Card>

        {/* Sealed */}
        <Card className="bg-background text-foreground border border-border shadow-sm">
          <CardContent className="p-4">
            <KpiLabel
              label="Sealed"
              tooltip="Confirmed/qualified intents matched to Ads sessions today."
            />
            <div className="mt-3 text-[2.5rem] leading-none font-bold tabular-nums">
              {loading ? <Skeleton className="h-10 w-24" /> : fmt(sealed)}
            </div>
            <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
              <Icons.check className="w-3 h-3" />
              Sealed
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Forms row (conditional) */}
      {formsEnabled && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-background text-foreground border border-border shadow-sm">
            <CardContent className="p-4">
              <KpiLabel
                label="Forms"
                tooltip="Form conversions (form_submit events) matched to Ads sessions today."
              />
              <div className="mt-3 text-[2.5rem] leading-none font-bold tabular-nums">
                {loading ? <Skeleton className="h-10 w-24" /> : fmt(forms)}
              </div>
              <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                <Icons.form className="w-3 h-3" />
                Form
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
