'use client';

import { useMemo, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { QualificationQueue } from './QualificationQueue';
import { BreakdownWidgets } from './widgets/BreakdownWidgets';
import { PulseProjectionWidgets } from './widgets/PulseProjectionWidgets';
import { CommandCenterP0Panel } from './CommandCenterP0Panel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCommandCenterP0Stats } from '@/lib/hooks/use-command-center-p0-stats';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';
import { getBadgeStatus } from '@/lib/realtime-badge-status';
import { cn } from '@/lib/utils';
import { strings } from '@/lib/i18n/en';
import { Home, Settings, Target, Shield, MoreHorizontal, Check, Zap, Flame } from 'lucide-react';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import Link from 'next/link';
import { LiveClock } from './LiveClock';
import './reset.css';

interface DashboardShellProps {
  siteId: string;
  siteName?: string;
  siteDomain?: string;
  /** Server-passed today range from URL; avoids hydration mismatch (data-to differs server vs client). */
  initialTodayRange?: { fromIso: string; toIso: string };
}

export function DashboardShell({ siteId, siteName, siteDomain, initialTodayRange }: DashboardShellProps) {
  const [selectedDay, setSelectedDay] = useState<'yesterday' | 'today'>('today');
  const [scope, setScope] = useState<'ads' | 'all'>('ads');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Real-time signals for the Shell
  const realtime = useRealtimeDashboard(siteId, undefined, { adsOnly: true });

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
    const toMs = todayStartUtcMs - 1;
    return { day: 'yesterday' as const, fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
  }, [selectedDay, initialFrom, initialTo]);

  // Scope-aware HUD stats
  const { stats, loading, error: statsError } = useCommandCenterP0Stats(
    siteId,
    { fromIso: queueRange.fromIso, toIso: queueRange.toIso },
    { scope }
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
      <div className="w-full h-9 px-4 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.2em] border-b border-slate-700 bg-slate-900 text-slate-400 z-[60] relative">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full animate-pulse bg-emerald-400" />
            {strings.operationsCenter.toUpperCase()} // OCI ACTIVE
          </div>
          <div className="hidden sm:block opacity-60 text-slate-500">
            LATENCY: {loading ? '...' : '12ms'}
          </div>
        </div>
        <LiveClock />
      </div>

      {/* Desktop-first Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="mx-auto max-w-7xl px-6 py-4 w-full min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-shrink-0">
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
              <div className="text-xs font-semibold uppercase tracking-wider px-3 pt-0.5 leading-none text-slate-500">{strings.p0CommandCenter}</div>
            </div>

            <div className="flex items-center gap-3 shrink-0 min-w-0">
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
                      {status === 'disconnected' ? 'OFFLINE' : 'UPLINK ACTIVE'}
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
                  <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500">Timeline</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setSelectedDay('yesterday')} className="focus:bg-slate-800 focus:text-emerald-400 cursor-pointer text-xs font-bold">
                    {selectedDay === 'yesterday' ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <span className="mr-2 w-4" />}
                    Yesterday Performance
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedDay('today')} className="focus:bg-slate-800 focus:text-emerald-400 cursor-pointer text-xs font-bold">
                    {selectedDay === 'today' ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <span className="mr-2 w-4" />}
                    Real-Time (Today)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-slate-800" />
                  <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500">Filters</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setScope('ads')} className="focus:bg-slate-800 focus:text-emerald-400 cursor-pointer text-xs font-bold">
                    {scope === 'ads' ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <span className="mr-2 w-4" />}
                    Paid Search (SEM)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setScope('all')} className="focus:bg-slate-800 focus:text-emerald-400 cursor-pointer text-xs font-bold">
                    {scope === 'all' ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <span className="mr-2 w-4" />}
                    Full Network Graph
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-slate-800" />
                  <DropdownMenuItem onClick={() => setSettingsOpen(true)} className="focus:bg-slate-800 focus:text-emerald-400 cursor-pointer text-xs font-bold">
                    <Settings className="mr-2 h-4 w-4" />
                    System Parameters
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogContent className="max-h-[80vh] overflow-y-auto bg-slate-900 border-slate-800 text-slate-100 shadow-2xl">
              <DialogHeader className="mb-4">
                <DialogTitle className="font-black uppercase tracking-widest text-emerald-400">Tactical Control Panel</DialogTitle>
              </DialogHeader>
              <CommandCenterP0Panel siteId={siteId} />
            </DialogContent>
          </Dialog>

          {statsError && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              {statsError}
            </div>
          )}
          {/* Scoreboard */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Capture', value: captured, icon: Target, sub: 'Verified' },
              { label: 'Shield', value: filtered, icon: Shield, sub: 'Redacted' },
              { label: 'Efficiency', value: `${gclidRatio}%`, icon: Zap, sub: 'GCLID Ratio' },
              { label: 'Interest', value: avgEngagement != null ? `${avgEngagement}%` : '—', icon: Flame, sub: 'Avg Scroll' }
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7">
            <div className="mb-3">
              <h2 className="text-base font-semibold text-slate-800">{strings.liveQueue}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{strings.liveQueueSubtitle}</p>
            </div>
            <QualificationQueue siteId={siteId} range={queueRange} scope={scope} />
          </div>
          <div className="lg:col-span-5 space-y-6">
            <div className="mb-1">
              <h2 className="text-base font-semibold text-slate-800">{strings.reports}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{strings.reportsSubtitle}</p>
            </div>
            <PulseProjectionWidgets
              siteId={siteId}
              dateRange={queueRange}
              scope={scope}
            />
          </div>
        </div>
        {/* Breakdown: full-width row */}
        <div className="mt-8 pt-6 border-t border-slate-200">
          <BreakdownWidgets
            siteId={siteId}
            dateRange={{ from: queueRange.fromIso, to: queueRange.toIso }}
            adsOnly={scope === 'ads'}
          />
        </div>
      </main>
    </div>
  );
}
