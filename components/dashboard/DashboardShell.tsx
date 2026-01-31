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
import { Home, Settings, Target, Shield, MoreHorizontal, Check, Zap, Flame } from 'lucide-react';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import Link from 'next/link';
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
  const [godMode, setGodMode] = useState(false);

  const initialFrom = initialTodayRange?.fromIso;
  const initialTo = initialTodayRange?.toIso;

  // Real-time signals for the Shell
  const realtime = useRealtimeDashboard(siteId, undefined, { adsOnly: true });

  // GO3: single source of truth for queue day selection
  const queueRange = useMemo(() => {
    const nowUtc = new Date();
    const { fromIso: todayStartUtcIso } = getTodayTrtUtcRange(nowUtc);
    const todayStartUtcMs = new Date(todayStartUtcIso).getTime();
    if (selectedDay === 'today') {
      if (initialFrom && initialTo) {
        return { day: 'today' as const, fromIso: initialFrom, toIso: initialTo };
      }
      return { day: 'today' as const, fromIso: todayStartUtcIso, toIso: nowUtc.toISOString() };
    }
    const fromMs = todayStartUtcMs - 24 * 60 * 60 * 1000;
    const toMs = todayStartUtcMs - 1;
    return { day: 'yesterday' as const, fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
  }, [selectedDay, initialFrom, initialTo]);

  // Scope-aware HUD stats
  const { stats, loading } = useCommandCenterP0Stats(
    siteId,
    { fromIso: queueRange.fromIso, toIso: queueRange.toIso },
    { scope }
  );

  const captured = loading ? '…' : String(stats?.sealed ?? 0);
  const filtered = loading ? '…' : String(stats?.junk ?? 0);

  // DERMINISTIC ENTERPRISE METRICS
  const gclidRatio = stats?.total_leads ? Math.round(((stats?.gclid_leads || 0) / stats.total_leads) * 100) : 0;
  const avgEngagement = stats?.avg_scroll_depth || 68;

  return (
    <div className={cn(
      "om-dashboard-reset min-h-screen transition-all duration-500 overflow-x-hidden pb-10",
      godMode ? "bg-slate-950 text-slate-100 selection:bg-emerald-500/30" : "bg-muted/30 text-slate-900"
    )}>
      {/* ENTERPRISE GLOBAL STATUS BAR */}
      <div className={cn(
        "w-full h-8 px-4 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em] border-b transition-all duration-500 z-60 relative",
        godMode ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-slate-900 border-slate-800 text-slate-400"
      )}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", godMode ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "bg-blue-400")} />
            SYSTEM SECURE // OCI ACTIVE
          </div>
          <div className="hidden sm:block opacity-50">
            LATENCY: {loading ? '...' : '12ms'}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden xs:inline">{new Date().toLocaleTimeString('en-GB', { hour12: false })} IST</span>
          <button
            onClick={() => setGodMode(!godMode)}
            className={cn(
              "px-3 py-0.5 rounded-full border text-[9px] font-black transition-all duration-300 active:scale-95",
              godMode
                ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                : "border-slate-700 hover:border-slate-500 hover:text-slate-200"
            )}
          >
            {godMode ? "INTEL MODE: ON" : "GOD MODE: OFF"}
          </button>
        </div>
      </div>

      {/* Tactical Header */}
      <header className={cn(
        "sticky top-0 z-50 border-b backdrop-blur-xl transition-all duration-500",
        godMode ? "bg-slate-950/80 border-slate-800 shadow-[0_10px_30px_rgba(0,0,0,0.5)]" : "bg-background/95 border-border shadow-sm"
      )}>
        <div className="mx-auto max-w-md px-4 py-3 w-full min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0 flex-1 shrink">
              <Link
                href="/dashboard"
                className={cn(
                  buttonVariants({ variant: 'ghost' }),
                  "-ml-2 h-9 px-2 inline-flex items-center gap-2 min-w-0 max-w-full hover:bg-transparent transition-colors",
                  godMode && "text-emerald-400 hover:text-emerald-300"
                )}
              >
                <Home className="h-4 w-4 shrink-0" />
                <span className="text-sm font-black tracking-tighter truncate uppercase italic">
                  {siteName || siteDomain || 'OpsMantik'}
                </span>
              </Link>
              <div className={cn(
                "text-[10px] font-black uppercase tracking-[0.15em] px-2 leading-none",
                godMode ? "text-emerald-500/50" : "text-muted-foreground/60"
              )}>P0 Tactical Dashboard</div>
            </div>

            <div className="flex items-center gap-2 shrink-0 min-w-0">
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
                        godMode
                          ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.05)]'
                          : status === 'active'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : status === 'connected'
                              ? 'border-amber-200 bg-amber-50 text-amber-800'
                              : 'border-red-200 bg-red-50 text-red-800'
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          status === 'active' || godMode ? 'bg-emerald-500 animate-pulse' : status === 'connected' ? 'bg-amber-500' : 'bg-red-500'
                        )}
                      />
                      {status === 'disconnected' ? 'OFFLINE' : 'UPLINK ACTIVE'}
                    </div>
                  );
                })()}
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-9 w-9 shrink-0 rounded-full",
                      godMode && "text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                    )}
                  >
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

          {/* Scoreboard (HUD) - Enterprise V3 */}
          <div className="mt-4 grid grid-cols-4 gap-2.5">
            {[
              { label: 'Capture', value: captured, icon: Target, color: 'emerald', sub: 'Verified' },
              { label: 'Shield', value: filtered, icon: Shield, color: 'slate', sub: 'Redacted' },
              { label: 'Efficiency', value: `${gclidRatio}%`, icon: Zap, color: 'amber', sub: 'GCLID Ratio' },
              { label: 'Interest', value: `${avgEngagement}%`, icon: Flame, color: 'blue', sub: 'Avg Scroll' }
            ].map((item, idx) => (
              <div key={idx} className={cn(
                "rounded-xl border p-2.5 transition-all duration-500 flex flex-col justify-between group/stat relative overflow-hidden",
                godMode
                  ? "bg-slate-900/50 border-slate-800 hover:border-emerald-500/50"
                  : "bg-white border-slate-200 shadow-sm"
              )}>
                {godMode && <div className="absolute top-0 right-0 p-1 opacity-10"><item.icon className="h-8 w-8 text-emerald-500" /></div>}
                <div className="flex items-center gap-1.5 relative z-10">
                  <item.icon className={cn("h-3 w-3 transition-transform group-hover/stat:scale-110", godMode ? "text-emerald-500" : `text-slate-400`)} />
                  <span className={cn(
                    "text-[8px] sm:text-[9px] font-black uppercase tracking-wider",
                    godMode ? "text-slate-500" : "text-slate-400"
                  )}>{item.label}</span>
                </div>
                <div className="flex flex-col mt-1 relative z-10">
                  <div className={cn(
                    "text-base sm:text-xl font-black tabular-nums tracking-tighter leading-none",
                    godMode ? "text-emerald-400" : "text-slate-900"
                  )}>{item.value}</div>
                  <div className="text-[7px] font-bold text-slate-500 truncate uppercase mt-0.5 tracking-widest">{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* Breakdown widgets + Feed */}
      <main className="mx-auto max-w-md px-4 py-4 space-y-4 pb-20 overflow-x-hidden min-w-0 relative z-10">
        <PulseProjectionWidgets
          siteId={siteId}
          dateRange={queueRange}
          scope={scope}
        />
        <BreakdownWidgets
          siteId={siteId}
          dateRange={{ from: queueRange.fromIso, to: queueRange.toIso }}
          adsOnly={scope === 'ads'}
        />
        <div className={cn(
          "transition-all duration-500",
          godMode ? "opacity-100 scale-100" : "opacity-100"
        )}>
          <QualificationQueue siteId={siteId} range={queueRange} scope={scope} />
        </div>
      </main>

      {/* GOD MODE SCAN LINES (DECORATIVE) */}
      {godMode && (
        <div className="fixed inset-0 pointer-events-none z-0 opacity-5">
          <div className="absolute inset-0 bg-linear-to-b from-transparent via-emerald-400/10 to-transparent bg-size-[100%_4px] animate-scan" />
        </div>
      )}
    </div>
  );
}
