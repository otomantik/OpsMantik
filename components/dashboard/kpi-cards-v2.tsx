'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { useDashboardStats } from '@/lib/hooks/use-dashboard-stats';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';
import { Icons } from '@/components/icons';
import { useMemo } from 'react';

interface KPICardsV2Props {
  siteId: string;
}

export function KPICardsV2({ siteId }: KPICardsV2Props) {
  const { formatNumber, t } = useTranslation();
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
          <p className="text-rose-800 text-sm mb-4">{t('kpi.criticalFailure')}: {error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="bg-background border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            <Icons.refresh className="w-3 h-3 mr-2" />
            {t('kpi.retryConnection')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const adsSessions = loading ? null : (stats?.ads_sessions ?? 0);
  const phoneIntents = loading ? null : (stats?.phone_click_intents ?? 0);
  const whatsappIntents = loading ? null : (stats?.whatsapp_click_intents ?? 0);
  const formsEnabled = Boolean(stats?.forms_enabled);
  const forms = loading ? null : (stats?.forms ?? 0);

  const hasNoActivity =
    !loading &&
    !!stats &&
    (adsSessions ?? 0) === 0 &&
    (phoneIntents ?? 0) === 0 &&
    (whatsappIntents ?? 0) === 0 &&
    (stats.total_events || 0) === 0;

  const fmt = (n: number | null) => (n === null ? '…' : formatNumber(n));

  return (
    <div className="space-y-4">
      {/* No Activity Helper */}
      {hasNoActivity && (
        <div className="px-4 py-2 bg-muted border border-border rounded-lg">
          <p className="text-sm text-muted-foreground text-center">
            {t('kpi.noActivityYet')} • {t('kpi.sendEventsToSeeMetrics')}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Ads Sessions */}
        <Card className="bg-background">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground tracking-wide">
                {t('kpi.adsSessions')}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => refetch()}
                title={t('button.refreshKpis')}
              >
                <Icons.refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-3xl font-semibold tabular-nums" suppressHydrationWarning>
              {loading ? <Skeleton className="h-9 w-20" /> : fmt(adsSessions)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{t('kpi.todayTrt')}</div>
          </CardContent>
        </Card>

        {/* Phone Intents */}
        <Card className="bg-background">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground tracking-wide">
                {t('kpi.phoneIntents')}
              </CardTitle>
              <Icons.phone className="h-4 w-4 text-blue-600" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-3xl font-semibold tabular-nums" suppressHydrationWarning>
              {loading ? <Skeleton className="h-9 w-20" /> : fmt(phoneIntents)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{t('kpi.clicks')}</div>
          </CardContent>
        </Card>

        {/* WhatsApp Intents */}
        <Card className="bg-background">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground tracking-wide">
                {t('kpi.whatsappIntents')}
              </CardTitle>
              <Icons.whatsappBrand className="h-4 w-4 text-green-600" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-3xl font-semibold tabular-nums" suppressHydrationWarning>
              {loading ? <Skeleton className="h-9 w-20" /> : fmt(whatsappIntents)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Clicks</div>
          </CardContent>
        </Card>

        {/* Forms (Hidden if not enabled) */}
        <Card className={formsEnabled ? "bg-background" : "bg-muted/40 border-dashed"}>
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground tracking-wide">
                {t('kpi.forms')}
              </CardTitle>
              <Icons.form className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-3xl font-semibold tabular-nums" suppressHydrationWarning>
              {loading ? <Skeleton className="h-9 w-20" /> : (formsEnabled ? fmt(forms) : t('kpi.hidden'))}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{t('kpi.conversions')}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
