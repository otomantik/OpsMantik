'use client';

import { useMemo, useState } from 'react';
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
import { getTodayTrtUtcRange, resolveDashboardDayTimezone } from '@/lib/time/today-range';
import { getBadgeStatus } from '@/lib/realtime-badge-status';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Home, Target, Shield, MoreHorizontal, Check, Zap, Flame, LogOut } from 'lucide-react';
import {
  SiteRealtimeDashboardProvider,
  useSiteRealtimeDashboard,
} from '@/lib/contexts/site-realtime-dashboard-context';
import Link from 'next/link';
import { LiveClock } from './live-clock';
import { LocaleSwitcher } from '@/components/locale-switcher';
import './reset.css';
import type { SiteRole } from '@/lib/auth/rbac';
import type { OpsMantikModule } from '@/lib/types/modules';
import { SiteModulesProvider } from '@/lib/contexts/site-modules-context';
import { useSiteTimezone } from '@/components/context/site-locale-context';
import { formatSupabaseClientError } from '@/lib/oci/format-supabase-error';

interface DashboardShellProps {
  siteId: string;
  siteName?: string;
  siteDomain?: string;
  /** Server-passed today range from URL; avoids hydration mismatch (data-to differs server vs client). */
  initialTodayRange?: { fromIso: string; toIso: string };
  siteRole: SiteRole;
  /** Tenant entitlements for module-gated dashboard features. Default [] when unknown. */
  activeModules?: OpsMantikModule[];
}

export function DashboardShell(props: DashboardShellProps) {
  return (
    <SiteRealtimeDashboardProvider siteId={props.siteId}>
      <DashboardShellInner {...props} />
    </SiteRealtimeDashboardProvider>
  );
}

function DashboardShellInner({
  siteId,
  siteName,
  siteDomain,
  initialTodayRange,
  siteRole,
  activeModules = [],
}: DashboardShellProps) {
  const { t } = useTranslation();
  const siteTimezone = useSiteTimezone();
  const resolvedTimezone = resolveDashboardDayTimezone(siteTimezone);
  const [selectedDay, setSelectedDay] = useState<'yesterday' | 'today'>('today');

  const realtime = useSiteRealtimeDashboard();

  const initialFrom = initialTodayRange?.fromIso?.trim();
  const initialTo = initialTodayRange?.toIso?.trim();

  const queueRange = useMemo(() => {
    const nowUtc = new Date();
    const { fromIso: todayStartUtcIso, toIso: todayEndUtcIso } = getTodayTrtUtcRange(nowUtc, resolvedTimezone);
    const todayStartUtcMs = new Date(todayStartUtcIso).getTime();
    if (selectedDay === 'today') {
      const fromIso = initialFrom || todayStartUtcIso;
      const toIso = initialTo || todayEndUtcIso;
      return { day: 'today' as const, fromIso, toIso };
    }
    const fromMs = todayStartUtcMs - 24 * 60 * 60 * 1000;
    const toMs = todayStartUtcMs;
    return { day: 'yesterday' as const, fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
  }, [selectedDay, initialFrom, initialTo, resolvedTimezone]);

  const { stats, loading, error: statsError } = useCommandCenterP0Stats(
    siteId,
    { fromIso: queueRange.fromIso, toIso: queueRange.toIso },
    { scope: 'all', siteTimezone: resolvedTimezone }
  );

  const captured = loading ? '…' : String(stats?.sealed ?? 0);
  const filtered = loading ? '…' : String(stats?.junk ?? 0);

  const gclidRatio = stats?.total_leads ? Math.round(((stats?.gclid_leads || 0) / stats.total_leads) * 100) : 0;
  const avgScroll = stats?.avg_scroll_depth;
  const avgEngagement = typeof avgScroll === 'number' && Number.isFinite(avgScroll) ? avgScroll : null;

  return (
    <SiteModulesProvider siteId={siteId} activeModules={activeModules}>
      <div className="om-dashboard-reset min-h-screen transition-all duration-500 overflow-x-hidden pb-10 bg-slate-100 text-slate-900">
        <div className="w-full h-9 px-4 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.2em] border-b border-slate-200 bg-white text-slate-600 z-60 relative">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full animate-pulse bg-emerald-500" />
              {t('sidebar.operationsCenter').toUpperCase()} • {t('statusBar.ociActive')}
            </div>
            <div className="hidden sm:block opacity-70 text-slate-500">
              {t('statusBar.latency')}: {selectedDay === 'today' ? t('dashboard.queue.todayWindow') : t('dashboard.queue.yesterdayWindow')}
            </div>
          </div>
          <LiveClock />
        </div>

        <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm shadow-sm">
          <div className="mx-auto max-w-7xl px-6 py-4 w-full min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 shrink-0">
                <Link
                  href="/dashboard"
                  className={cn(
                    buttonVariants({ variant: 'ghost' }),
                    '-ml-2 h-10 px-3 inline-flex items-center gap-2 min-w-0 hover:bg-slate-100 transition-colors rounded-lg'
                  )}
                >
                  <Home className="h-5 w-5 shrink-0 text-slate-600" />
                  <span className="text-base font-bold tracking-tight text-slate-800 truncate max-w-[240px] sm:max-w-none">
                    {siteName || siteDomain || 'OpsMantik'}
                  </span>
                </Link>
                <div className="text-xs font-semibold uppercase tracking-wider px-3 pt-0.5 leading-none text-slate-500">
                  {t('sidebar.p0CommandCenter')}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 min-w-0">
                <div className="hidden sm:block shrink-0">
                  <LocaleSwitcher />
                </div>
                <Link
                  href="#niyetler"
                  className={cn(
                    buttonVariants({ variant: 'outline' }),
                    'h-9 px-2 sm:px-3 text-[10px] sm:text-xs font-bold uppercase tracking-wider border-slate-200 bg-white hover:bg-slate-50 shrink-0 whitespace-nowrap'
                  )}
                >
                  {t('dashboard.intents')}
                </Link>
                <Link
                  href="/panel"
                  className={cn(
                    buttonVariants({ variant: 'outline' }),
                    'h-9 px-2 sm:px-3 text-[10px] sm:text-xs font-bold uppercase tracking-wider border-slate-200 bg-white hover:bg-slate-50 shrink-0 whitespace-nowrap'
                  )}
                >
                  {t('dashboard.openPanelLabel')}
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
                          'inline-flex items-center gap-2 rounded-full border px-2 sm:px-3 py-1 text-[10px] font-black uppercase tracking-tighter transition-all duration-500 shrink-0',
                          status === 'active'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : status === 'connected'
                              ? 'border-amber-200 bg-amber-50 text-amber-800'
                              : 'border-red-200 bg-red-50 text-red-800'
                        )}
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full shrink-0',
                            status === 'active'
                              ? 'bg-emerald-500 animate-pulse'
                              : status === 'connected'
                                ? 'bg-amber-500'
                                : 'bg-red-500'
                          )}
                        />
                        <span className="hidden min-[420px]:inline">
                          {status === 'disconnected' ? t('statusBar.offline') : t('statusBar.uptimeActive')}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" data-testid="header-overflow-menu-trigger">
                      <MoreHorizontal className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 bg-slate-900 border-slate-800 text-slate-100 shadow-2xl" data-testid="header-overflow-menu-content">
                    <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('dashboard.timeline')}</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => setSelectedDay('yesterday')} className="focus:bg-slate-800 focus:text-emerald-400 cursor-pointer text-xs font-bold">
                      {selectedDay === 'yesterday' ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <span className="mr-2 w-4" />}
                      {t('dashboard.yesterdayPerformance')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedDay('today')} className="focus:bg-slate-800 focus:text-emerald-400 cursor-pointer text-xs font-bold">
                      {selectedDay === 'today' ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <span className="mr-2 w-4" />}
                      {t('dashboard.realtimeToday')}
                    </DropdownMenuItem>
                    <div className="mt-2 pt-2 border-t border-slate-700">
                      <Link href={`/dashboard/site/${siteId}/activity`} className="block">
                        <DropdownMenuItem className="focus:bg-slate-800 focus:text-emerald-400 cursor-pointer text-xs font-bold">
                          {t('dashboard.activityLog')}
                        </DropdownMenuItem>
                      </Link>
                      <Link href={`/dashboard/site/${siteId}/oci-control`} className="block">
                        <DropdownMenuItem className="focus:bg-slate-800 focus:text-emerald-400 cursor-pointer text-xs font-bold">
                          {t('ociControl.title')}
                        </DropdownMenuItem>
                      </Link>
                    </div>
                    <div className="sm:hidden mt-2 pt-2 border-t border-slate-700">
                      <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('common.language')}</DropdownMenuLabel>
                      <div className="mt-2">
                        <LocaleSwitcher />
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-700">
                      <form action="/auth/signout" method="post" className="w-full">
                        <button type="submit" className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-bold text-slate-300 hover:text-red-300 hover:bg-slate-800 rounded cursor-pointer" data-testid="menu-item-signout">
                          <LogOut className="h-4 w-4 shrink-0" />
                          {t('dashboard.signOut')}
                        </button>
                      </form>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {statsError && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                {formatSupabaseClientError(statsError)}
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: t('kpi.capture'), value: captured, icon: Target, sub: t('kpi.verified') },
                { label: t('kpi.shield'), value: filtered, icon: Shield, sub: t('kpi.redacted') },
                { label: t('kpi.efficiency'), value: `${gclidRatio}%`, icon: Zap, sub: t('kpi.gclidRatio') },
                { label: t('kpi.interest'), value: avgEngagement != null ? `${avgEngagement}%` : '—', icon: Flame, sub: t('kpi.avgScroll') },
              ].map((item, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm flex flex-col justify-between min-h-[72px]">
                  <div className="flex items-center gap-2">
                    <item.icon className="h-4 w-4 text-slate-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{item.label}</span>
                  </div>
                  <div>
                    <div className="text-xl sm:text-2xl font-bold tabular-nums leading-tight text-slate-900">{item.value}</div>
                    <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mt-0.5">{item.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-6 py-6 pb-16 overflow-x-hidden min-w-0 relative z-10">
          <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600" data-testid="analytics-retired-notice">
            {t('dashboard.analyticsRetired.noticePrefix')}{' '}
            <Link href="/panel" className="font-semibold text-slate-900 underline underline-offset-2">
              {t('dashboard.analyticsRetired.panelLinkLabel')}
            </Link>{' '}
            {t('dashboard.analyticsRetired.noticeSuffix')}
          </div>
          <div id="niyetler">
            <div className="mb-3">
              <h2 className="text-base font-semibold text-slate-800">{t('dashboard.intents')}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('dashboard.intentsSubtitle')}</p>
            </div>
            <QualificationQueue siteId={siteId} range={queueRange} siteRole={siteRole} />
          </div>
        </main>
      </div>
    </SiteModulesProvider>
  );
}
