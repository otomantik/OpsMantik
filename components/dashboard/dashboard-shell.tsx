'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button, buttonVariants } from '@/components/ui/button';
import { QualificationQueue } from './qualification-queue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCommandCenterP0Stats } from '@/lib/hooks/use-command-center-p0-stats';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';
import { getBadgeStatus } from '@/lib/realtime-badge-status';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Home, Target, Shield, MoreHorizontal, Check, Zap, Flame } from 'lucide-react';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import Link from 'next/link';
import { LiveClock } from './live-clock';
import { useFunnelAnalytics } from '@/lib/hooks/use-funnel-analytics';
import { CROInsights } from './widgets/cro-insights';
import './reset.css';
import type { SiteRole } from '@/lib/auth/rbac';

interface DashboardShellProps {
  siteId: string;
  siteName?: string;
  siteDomain?: string;
  /** Site i18n config (currency, timezone, locale) for formatting. */
  siteConfig?: { currency?: string; timezone?: string; locale?: string };
  /** Server-passed today range from URL; avoids hydration mismatch (data-to differs server vs client). */
  initialTodayRange?: { fromIso: string; toIso: string };
  siteRole: SiteRole;
}

const BreakdownWidgets = dynamic(
  () => import('./widgets/breakdown-widgets').then((mod) => mod.BreakdownWidgets),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4">
        <div className="h-6 w-32 bg-slate-100 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-[300px] bg-slate-50 rounded-xl border border-slate-200 animate-pulse" />
          <div className="h-[300px] bg-slate-50 rounded-xl border border-slate-200 animate-pulse" />
          <div className="h-[300px] bg-slate-50 rounded-xl border border-slate-200 animate-pulse" />
        </div>
      </div>
    ),
  }
);

const PulseProjectionWidgets = dynamic(
  () => import('./widgets/pulse-projection-widgets').then((mod) => mod.PulseProjectionWidgets),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-[180px] bg-slate-50 rounded-xl border border-slate-200 animate-pulse" />
        <div className="h-[180px] bg-slate-50 rounded-xl border border-slate-200 animate-pulse" />
      </div>
    ),
  }
);

const TrafficSourceBreakdown = dynamic(
  () => import('./widgets/traffic-source-breakdown').then((mod) => mod.TrafficSourceBreakdown),
  {
    ssr: false,
    loading: () => (
      <div className="bg-slate-50 rounded-xl border border-slate-200 h-[400px] animate-pulse" />
    ),
  }
);

export function DashboardShell({ siteId, siteName, siteDomain, siteConfig, initialTodayRange, siteRole }: DashboardShellProps) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<'yesterday' | 'today'>('today');

  // Real-time signals for the Shell
  // Holistic View: always show ALL traffic (no ads-only filter).
  const realtime = useRealtimeDashboard(siteId, undefined, { adsOnly: false });

  // Funnel analytics and CRO insights
  const { metrics, loading: analyticsLoading } = useFunnelAnalytics(siteId);

  const initialFrom = initialTodayRange?.fromIso?.trim();
  const initialTo = initialTodayRange?.toIso?.trim();

  // GO3: single source of truth for queue day selection.
  const queueRange = useMemo(() => {
    const nowUtc = new Date();
    const { fromIso: todayStartUtcIso, toIso: todayEndUtcIso } = getTodayTrtUtcRange(nowUtc);
    const todayStartUtcMs = new Date(todayStartUtcIso).getTime();
    if (selectedDay === 'today') {
      // IMPORTANT: Use full TRT day [start, next day start) (same as server redirect).
      // This avoids "today empty" when DB timestamps drift slightly into the future (TRT/UTC offset bugs).
      const fromIso = initialFrom || todayStartUtcIso;
      const toIso = initialTo || todayEndUtcIso;
      return { day: 'today' as const, fromIso, toIso };
    }
    const fromMs = todayStartUtcMs - 24 * 60 * 60 * 1000;
    // Half-open range [yesterdayStart, todayStart)
    const toMs = todayStartUtcMs;
    return { day: 'yesterday' as const, fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
  }, [selectedDay, initialFrom, initialTo]);

  // Scope-aware HUD stats
  const { stats, loading, error: statsError } = useCommandCenterP0Stats(
    siteId,
    { fromIso: queueRange.fromIso, toIso: queueRange.toIso },
    { scope: 'all' }
  );

  const captured = loading ? '…' : String(stats?.sealed ?? 0);
  const filtered = loading ? '…' : String(stats?.junk ?? 0);

  // DERMINISTIC ENTERPRISE METRICS (no fake fallback for scroll — show — when no data)
  const gclidRatio = stats?.total_leads ? Math.round(((stats?.gclid_leads || 0) / stats.total_leads) * 100) : 0;
  const avgScroll = stats?.avg_scroll_depth;
  const avgEngagement = typeof avgScroll === 'number' && Number.isFinite(avgScroll) ? avgScroll : null;

  return (
    <div className="om-dashboard-reset min-h-screen transition-all duration-500 overflow-x-hidden pb-10 bg-slate-100 text-slate-900">
      {/* ENTERPRISE GLOBAL STATUS BAR */}
      <div className="w-full h-9 px-4 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.2em] border-b border-slate-200 bg-white text-slate-600 z-60 relative">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full animate-pulse bg-emerald-500" />
            {t('sidebar.operationsCenter').toUpperCase()} {' // '}{t('statusBar.ociActive')}
          </div>
          <div className="hidden sm:block opacity-70 text-slate-500">
            {t('statusBar.latency')}: {loading ? '...' : '12ms'}
          </div>
        </div>
        <LiveClock />
      </div>

      {/* Desktop-first Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="mx-auto max-w-7xl px-6 py-4 w-full min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 shrink-0">
              <Link
                href="/dashboard"
                className={cn(
                  buttonVariants({ variant: 'ghost' }),
                  "-ml-2 h-10 px-3 inline-flex items-center gap-2 min-w-0 hover:bg-slate-100 transition-colors rounded-lg"
                )}
              >
                <Home className="h-5 w-5 shrink-0 text-slate-600" />
                <span className="text-base font-bold tracking-tight text-slate-800 truncate max-w-[240px] sm:max-w-none">
                  {siteName || siteDomain || 'OpsMantik'}
                </span>
              </Link>
              <div className="text-xs font-semibold uppercase tracking-wider px-3 pt-0.5 leading-none text-slate-500">{t('sidebar.p0CommandCenter')}</div>
            </div>

            <div className="flex items-center gap-3 shrink-0 min-w-0">
              <Link
                href={`/dashboard/site/${siteId}/activity`}
                className={cn(
                  buttonVariants({ variant: 'outline' }),
                  'h-9 px-3 text-xs font-bold uppercase tracking-wider border-slate-200 bg-white hover:bg-slate-50'
                )}
              >
                {t('dashboard.activityLog')}
              </Link>
              <div className="shrink-0 flex flex-col items-end">
                {(() => {
                  const status = getBadgeStatus({
                    isConnected: realtime.isConnected,
                    lastSignalAt: realtime.lastSignalAt,
                  });
                  return (
                    <div
                      className={cn(
                        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-tighter transition-all duration-500',
                        status === 'active'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : status === 'connected'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-red-200 bg-red-50 text-red-800'
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          status === 'active' ? 'bg-emerald-500 animate-pulse' : status === 'connected' ? 'bg-amber-500' : 'bg-red-500'
                        )}
                      />
                      {status === 'disconnected' ? t('statusBar.offline') : t('statusBar.uptimeActive')}
                    </div>
                  );
                })()}
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full">
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-slate-900 border-slate-800 text-slate-100 shadow-2xl">
                  <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('dashboard.timeline')}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setSelectedDay('yesterday')} className="focus:bg-slate-800 focus:text-emerald-400 cursor-pointer text-xs font-bold">
                    {selectedDay === 'yesterday' ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <span className="mr-2 w-4" />}
                    {t('dashboard.yesterdayPerformance')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedDay('today')} className="focus:bg-slate-800 focus:text-emerald-400 cursor-pointer text-xs font-bold">
                    {selectedDay === 'today' ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <span className="mr-2 w-4" />}
                    {t('dashboard.realtimeToday')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {statsError && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              {statsError}
            </div>
          )}
          {/* Scoreboard */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: t('kpi.capture'), value: captured, icon: Target, sub: t('kpi.verified') },
              { label: t('kpi.shield'), value: filtered, icon: Shield, sub: t('kpi.redacted') },
              { label: t('kpi.efficiency'), value: `${gclidRatio}%`, icon: Zap, sub: t('kpi.gclidRatio') },
              { label: t('kpi.interest'), value: avgEngagement != null ? `${avgEngagement}%` : '—', icon: Flame, sub: t('kpi.avgScroll') }
            ].map((item, idx) => (
              <div key={idx} className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm flex flex-col justify-between min-h-[72px]">
                <div className="flex items-center gap-2">
                  <item.icon className="h-4 w-4 text-slate-500" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{item.label}</span>
                </div>
                <div className="mt-2">
                  <div className="text-xl sm:text-2xl font-bold tabular-nums leading-tight text-slate-900">{item.value}</div>
                  <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mt-0.5">{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* Desktop: Live Queue first (left), then Reports; full-width Breakdown below */}
      <main className="mx-auto max-w-7xl px-6 py-6 pb-16 overflow-x-hidden min-w-0 relative z-10">
        {/* CRO INSIGHTS TOP BAR */}
        <div className="mb-8">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-slate-800">{t('cro.title')}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('cro.subtitle')}</p>
          </div>
          <CROInsights metrics={metrics} loading={analyticsLoading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7">
            <div className="mb-3">
              <h2 className="text-base font-semibold text-slate-800">{t('sidebar.liveQueue')}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('sidebar.liveQueueSubtitle')}</p>
            </div>
            <QualificationQueue siteId={siteId} range={queueRange} siteRole={siteRole} />
          </div>
          <div className="lg:col-span-5 space-y-6">
            <div className="mb-1">
              <h2 className="text-base font-semibold text-slate-800">{t('sidebar.reports')}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('sidebar.reportsSubtitle')}</p>
            </div>
            {/* Wrap in Suspense? No, dynamic has loading */}
            <TrafficSourceBreakdown
              siteId={siteId}
              dateRange={{ from: queueRange.fromIso, to: queueRange.toIso }}
            />
            <PulseProjectionWidgets
              siteId={siteId}
              dateRange={queueRange}
              scope="all"
            />
          </div>
        </div>
        {/* Breakdown: full-width row */}
        <div className="mt-8 pt-6 border-t border-slate-200">
          <BreakdownWidgets
            siteId={siteId}
            dateRange={{ from: queueRange.fromIso, to: queueRange.toIso }}
            adsOnly={false}
          />
        </div>
      </main>
    </div>
  );
}
