'use client';

import { useDashboardStats } from '@/lib/hooks/use-dashboard-stats';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertCircle, Info } from 'lucide-react';

interface StatsCardsProps {
  siteId?: string;
  dateRange?: { from: Date; to: Date };
  adsOnly?: boolean;
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
        <div className="text-sm font-mono text-slate-700 uppercase tracking-wider">{label}</div>
        <div className="relative group">
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            aria-label={`${label} tooltip`}
          >
            <Info className="h-4 w-4" />
          </button>
          <div className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-[260px] rounded border border-slate-200 bg-white p-3 text-sm font-mono text-slate-800 shadow-lg group-hover:block">
            {tooltip}
          </div>
        </div>
      </div>
      {rightSlot}
    </div>
  );
}

export function StatsCards({ siteId, dateRange, adsOnly = false }: StatsCardsProps) {
  const { stats, loading, error, refetch } = useDashboardStats(siteId, dateRange);

  // Realtime updates for optimistic KPI refresh
  useRealtimeDashboard(siteId, {
    onEventCreated: () => {
      // Optimistically refresh stats when new events arrive
      // Note: Only for KPIs, not for charts (per Phase 5 bounded refresh strategy)
      refetch();
    },
    onCallCreated: () => {
      // Optimistically refresh stats when new calls arrive
      refetch();
    },
    onDataFreshness: () => {
      // Update last_event_at optimistically
      refetch();
    },
  }, { adsOnly });

  if (error) {
    return (
      <Card className="border border-rose-200 bg-rose-50">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="w-10 h-10 text-rose-600 mb-2" />
          <p className="text-rose-800 font-mono text-sm mb-4">Critical failure: {error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="bg-white border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            <RefreshCw className="w-3 h-3 mr-2" />
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
      {/* No Activity Helper - Only show when all zeros */}
      {hasNoActivity && (
        <div className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg">
          <p className="text-sm font-mono text-slate-700 text-center">
            No activity yet • Send events from your site to see metrics here
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Ads Sessions */}
        <Card className="bg-white border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <KpiLabel
              label="Ads Sessions"
              tooltip="Unique Ads-attributed sessions in the selected range. (Ads-only filter applied.)"
              rightSlot={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-slate-600 hover:text-slate-800"
                  onClick={() => refetch()}
                  title="Refresh KPIs"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              }
            />
            <div className="mt-3 text-[2.5rem] leading-none font-bold font-mono tabular-nums text-slate-900">
              {fmt(adsSessions)}
            </div>
            <div className="mt-2 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-mono text-slate-700">
              KPI
            </div>
          </CardContent>
        </Card>

        {/* Phone Click Intents */}
        <Card className="bg-white border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <KpiLabel
              label="Phone Click Intents"
              tooltip="Phone click intents (calls.source='click', status intent/null) matched to an Ads session in-range."
            />
            <div className="mt-3 text-[2.5rem] leading-none font-bold font-mono tabular-nums text-slate-900">
              {fmt(phoneIntents)}
            </div>
            <div className="mt-2 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-mono text-slate-700">
              Click
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp Click Intents */}
        <Card className="bg-white border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <KpiLabel
              label="WhatsApp Click Intents"
              tooltip="WhatsApp click intents (calls.source='click', status intent/null) matched to an Ads session in-range."
            />
            <div className="mt-3 text-[2.5rem] leading-none font-bold font-mono tabular-nums text-slate-900">
              {fmt(whatsappIntents)}
            </div>
            <div className="mt-2 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-mono text-slate-700">
              Click
            </div>
          </CardContent>
        </Card>

        {/* Forms */}
        <Card className={formsEnabled ? "bg-white border border-slate-200 shadow-sm" : "bg-slate-50 border border-dashed border-slate-200 shadow-sm"}>
          <CardContent className="p-4">
            <KpiLabel
              label="Forms"
              tooltip="Form conversions (events.category='conversion' AND action='form_submit'). If a site never sends form_submit, this KPI shows Hidden."
            />
            <div className={`mt-3 text-[2.5rem] leading-none font-bold font-mono tabular-nums ${formsEnabled ? 'text-slate-900' : 'text-slate-500'}`}>
              {formsEnabled ? fmt(forms) : 'Hidden'}
            </div>
            <div className="mt-2 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-mono text-slate-700">
              Conversion
            </div>
          </CardContent>
        </Card>

        {/* Sealed */}
        <Card className="bg-white border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <KpiLabel
              label="Sealed"
              tooltip="Sealed calls: status in (confirmed, qualified, real) matched to an Ads session in-range."
            />
            <div className="mt-3 text-[2.5rem] leading-none font-bold font-mono tabular-nums text-slate-900">
              {fmt(sealed)}
            </div>
            <div className="mt-2 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-mono text-slate-700">
              Outcome
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
