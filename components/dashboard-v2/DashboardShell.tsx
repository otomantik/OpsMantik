'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { QualificationQueue } from './QualificationQueue';
import { CommandCenterP0Panel } from './CommandCenterP0Panel';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useCommandCenterP0Stats } from '@/lib/hooks/use-command-center-p0-stats';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';
import { cn } from '@/lib/utils';
import { Settings, Target, Shield, Wallet } from 'lucide-react';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import './reset.css';

interface DashboardShellProps {
  siteId: string;
  siteName?: string;
  siteDomain?: string;
}

export function DashboardShell({ siteId, siteName, siteDomain }: DashboardShellProps) {
  const [selectedDay, setSelectedDay] = useState<'yesterday' | 'today'>('today');
  const supabaseEnvOk = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // GO2: single source of truth for queue day selection (TRT boundaries, absolute UTC range)
  // - today:   [today 00:00 TRT, now]
  // - yday:    [yday 00:00 TRT, yday 23:59:59.999 TRT]
  const queueRange = useMemo(() => {
    const nowUtc = new Date();
    const { fromIso: todayStartUtcIso } = getTodayTrtUtcRange(nowUtc);
    const todayStartUtcMs = new Date(todayStartUtcIso).getTime();
    if (selectedDay === 'today') {
      // GO2 Fix: Stable range for today. Use a fixed 'now' per selection to prevent infinite loop.
      return { day: 'today' as const, fromIso: todayStartUtcIso, toIso: nowUtc.toISOString() };
    }
    const fromMs = todayStartUtcMs - 24 * 60 * 60 * 1000;
    const toMs = todayStartUtcMs - 1; // inclusive end-of-yesterday (23:59:59.999 TRT)
    return { day: 'yesterday' as const, fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
  }, [selectedDay]); // toIso is only updated when day toggle is clicked!

  // GO2: keep HUD stats unchanged (still "today" stats source)
  const { stats, loading } = useCommandCenterP0Stats(siteId);
  const captured = loading ? '…' : String(stats?.sealed ?? 0);
  const filtered = loading ? '…' : String(stats?.junk ?? 0);
  const saved = loading ? '…' : `${(stats?.estimated_budget_saved ?? 0).toLocaleString()} ${stats?.currency || ''}`.trim();

  const realtime = useRealtimeDashboard(siteId, undefined, { adsOnly: true });
  const showRealtimeDebug =
    typeof window !== 'undefined' && window.localStorage?.getItem('opsmantik_debug') === '1';

  return (
    <div className="om-dashboard-reset min-h-screen bg-muted/30">
      {/* Tactical Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Brand */}
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {siteName || siteDomain || 'OpsMantik'}
              </div>
              <div className="text-sm text-muted-foreground truncate">Hunter Terminal</div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Live pulse (connectivity + activity, independent from ads-only filtering) */}
              <div className="text-right">
                <div
                  data-testid="live-badge"
                  data-live={realtime.isLive ? '1' : '0'}
                  data-ads-live={realtime.adsLive ? '1' : '0'}
                  data-connected={realtime.isConnected ? '1' : '0'}
                  data-connection-status={realtime.connectionStatus || ''}
                  data-connection-error={realtime.error || ''}
                  data-supabase-env={supabaseEnvOk ? '1' : '0'}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs font-semibold tabular-nums',
                    realtime.isConnected && realtime.isLive
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : realtime.isConnected
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-red-200 bg-red-50 text-red-800'
                  )}
                  title={
                    realtime.lastSignalAt
                      ? `Last: ${realtime.lastSignalType || 'unknown'} @ ${realtime.lastSignalAt.toISOString()}`
                      : 'No realtime signals yet'
                  }
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', realtime.isLive ? 'bg-emerald-600' : 'bg-red-600')} />
                  <span>{realtime.isLive ? 'LIVE' : realtime.isConnected ? 'OFFLINE' : 'DISCONNECTED'}</span>
                  {realtime.adsLive && (
                    <span className="inline-flex items-center gap-1 rounded bg-background/60 px-1.5 py-0.5 text-[10px] font-bold">
                      ADS LIVE
                    </span>
                  )}
                </div>
                {showRealtimeDebug && (
                  <div
                    data-testid="realtime-debug"
                    className="mt-1 text-[10px] text-muted-foreground tabular-nums"
                    suppressHydrationWarning
                  >
                    lastSignalAt={realtime.lastSignalAt ? realtime.lastSignalAt.toISOString() : '—'} • type=
                    {realtime.lastSignalType || '—'}
                  </div>
                )}
              </div>

              {/* Day toggle */}
              <div className="inline-flex items-center rounded-md border border-border bg-background">
                <button
                  type="button"
                  onClick={() => setSelectedDay('yesterday')}
                  className={cn(
                    'px-3 py-1.5 text-sm tabular-nums',
                    'first:rounded-l-md last:rounded-r-md',
                    selectedDay === 'yesterday'
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                  aria-pressed={selectedDay === 'yesterday'}
                >
                  Yesterday
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDay('today')}
                  className={cn(
                    'px-3 py-1.5 text-sm tabular-nums',
                    'first:rounded-l-md last:rounded-r-md',
                    selectedDay === 'today'
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                  aria-pressed={selectedDay === 'today'}
                >
                  Today
                </button>
              </div>

              {/* Settings -> Command Center modal */}
              <Dialog>
                <DialogTrigger>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    aria-label="Settings"
                    data-testid="settings-trigger"
                  >
                    <Settings className="h-5 w-5" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[80vh] overflow-y-auto">
                  <DialogHeader className="mb-4">
                    <DialogTitle>Settings</DialogTitle>
                  </DialogHeader>
                  <CommandCenterP0Panel siteId={siteId} />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Scoreboard (HUD) */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Target className="h-4 w-4 text-emerald-600" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Captured</span>
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{captured}</div>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Filtered</span>
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{filtered}</div>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Wallet className="h-4 w-4 text-amber-600" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Saved</span>
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-amber-700 truncate">{saved}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Feed */}
      <main className="mx-auto max-w-md px-4 py-4 space-y-4 pb-20">
        <QualificationQueue siteId={siteId} range={queueRange} />

        {/* Kill Feed placeholder (Phase 2) */}
        <Card className="border border-dashed border-border bg-background">
          <div className="p-4">
            <div className="text-sm font-medium">Kill Feed (History)</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Coming next: a lightweight list of processed leads (time • identity • status).
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
