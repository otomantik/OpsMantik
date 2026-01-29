'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { QualificationQueue } from './QualificationQueue';
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
import { cn, formatTimestampWithTZ } from '@/lib/utils';
import { Home, Settings, Target, Shield, Wallet, MoreHorizontal, Check } from 'lucide-react';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import './reset.css';

interface DashboardShellProps {
  siteId: string;
  siteName?: string;
  siteDomain?: string;
}

export function DashboardShell({ siteId, siteName, siteDomain }: DashboardShellProps) {
  const [selectedDay, setSelectedDay] = useState<'yesterday' | 'today'>('today');
  const supabaseEnvOk = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [scope, setScope] = useState<'ads' | 'all'>('ads'); // default ADS ONLY
  const [settingsOpen, setSettingsOpen] = useState(false);

  // GO3: single source of truth for queue day selection (Europe/Istanbul TRT boundaries, UTC)
  // - today:   date_from = today 00:00 TRT, date_to = now
  // - yesterday: date_from = yesterday 00:00 TRT, date_to = yesterday 23:59:59.999 TRT
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

  // Scope-aware HUD stats (refetches when scope or range changes)
  const { stats, loading } = useCommandCenterP0Stats(
    siteId,
    { fromIso: queueRange.fromIso, toIso: queueRange.toIso },
    { scope }
  );
  const captured = loading ? '…' : String(stats?.sealed ?? 0);
  const filtered = loading ? '…' : String(stats?.junk ?? 0);
  const saved = loading ? '…' : `${(stats?.estimated_budget_saved ?? 0).toLocaleString()} ${stats?.currency || ''}`.trim();

  const realtime = useRealtimeDashboard(siteId, undefined, { adsOnly: true });
  const showRealtimeDebug =
    typeof window !== 'undefined' && window.localStorage?.getItem('opsmantik_debug') === '1';

  // Role lookup (client-side, best-effort)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const supabase = createClient();
        const { data: userRes } = await supabase.auth.getUser();
        const user = userRes?.user;
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        if (cancelled) return;
        setRole(profile?.role === 'admin' ? 'admin' : 'user');
      } catch {
        // keep default 'user'
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="om-dashboard-reset min-h-screen bg-muted/30">
      {/* Tactical Header */}
      <header className="sticky top-0 z-50 relative border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Brand: min-w-0 + truncate to prevent overflow */}
            <div className="min-w-0 flex-1">
              <Link
                href="/dashboard"
                className={cn(
                  buttonVariants({ variant: 'ghost' }),
                  '-ml-2 h-9 px-2 inline-flex items-center gap-2 min-w-0 max-w-full'
                )}
              >
                <Home className="h-4 w-4 shrink-0" />
                <span className="text-sm font-semibold truncate">
                  {siteName || siteDomain || 'OpsMantik'}
                </span>
              </Link>
              <div className="text-sm text-muted-foreground truncate">Hunter Terminal</div>
            </div>

            {/* Right: status badge + (desktop: toggles) + overflow menu — no shrink-0 so it can wrap/truncate on mobile */}
            <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
              {/* Status badge: DISCONNECTED / CONNECTED / ACTIVE (connectivity vs activity) */}
              <div className="shrink-0">
                {(() => {
                  const status = getBadgeStatus({
                    isConnected: realtime.isConnected,
                    lastSignalAt: realtime.lastSignalAt,
                  });
                  const lastSignalLabel = realtime.lastSignalAt
                    ? formatTimestampWithTZ(realtime.lastSignalAt.toISOString(), {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : '—';
                  return (
                    <>
                      <div
                        data-testid="live-badge"
                        data-badge-status={status}
                        data-connected={realtime.isConnected ? '1' : '0'}
                        data-last-signal-at={realtime.lastSignalAt?.toISOString() ?? ''}
                        data-live={realtime.adsLive ? '1' : '0'}
                        data-ads-live={realtime.adsLive ? '1' : '0'}
                        data-connection-status={realtime.connectionStatus || ''}
                        data-connection-error={realtime.error || ''}
                        data-supabase-env={supabaseEnvOk ? '1' : '0'}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs font-semibold tabular-nums',
                          status === 'active'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : status === 'connected'
                              ? 'border-amber-200 bg-amber-50 text-amber-800'
                              : 'border-red-200 bg-red-50 text-red-800'
                        )}
                        title={`Last signal: ${lastSignalLabel}`}
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            status === 'active'
                              ? 'bg-emerald-600'
                              : status === 'connected'
                                ? 'bg-amber-600'
                                : 'bg-red-600'
                          )}
                        />
                        <span>
                          {status === 'disconnected'
                            ? 'DISCONNECTED'
                            : status === 'connected'
                              ? 'CONNECTED'
                              : 'ACTIVE'}
                        </span>
                        {realtime.adsLive && (
                          <span className="inline-flex items-center gap-1 rounded bg-background/60 px-1.5 py-0.5 text-[10px] font-bold">
                            ADS LIVE
                          </span>
                        )}
                      </div>
                      <div
                        className="mt-0.5 text-[10px] text-muted-foreground tabular-nums"
                        data-testid="last-signal-label"
                        title={`Last signal: ${lastSignalLabel}`}
                      >
                        Last signal: {lastSignalLabel}
                      </div>
                      {showRealtimeDebug && (
                        <div
                          data-testid="realtime-debug"
                          data-debug-last-signal-type={realtime.lastSignalType ?? ''}
                          data-debug-last-signal-at={realtime.lastSignalAt?.toISOString() ?? ''}
                          className="mt-1 text-[10px] text-muted-foreground tabular-nums"
                          suppressHydrationWarning
                        >
                          lastSignalType={realtime.lastSignalType || '—'} • lastSignalAt=
                          {realtime.lastSignalAt ? realtime.lastSignalAt.toISOString() : '—'}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Desktop only: Day + Scope toggles (hidden on mobile to avoid overflow) */}
              <div className="hidden sm:inline-flex items-center gap-2">
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
                <div className="inline-flex items-center rounded-md border border-border bg-background">
                  <button
                    type="button"
                    onClick={() => setScope('ads')}
                    className={cn(
                      'px-3 py-1.5 text-sm tabular-nums',
                      'first:rounded-l-md last:rounded-r-md',
                      scope === 'ads'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                    aria-pressed={scope === 'ads'}
                  >
                    ADS ONLY
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope('all')}
                    className={cn(
                      'px-3 py-1.5 text-sm tabular-nums',
                      'first:rounded-l-md last:rounded-r-md',
                      scope === 'all'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                    aria-pressed={scope === 'all'}
                  >
                    ALL TRAFFIC
                  </button>
                </div>
              </div>

              {/* Overflow menu (⋯) — mobile: only this + badge; desktop: also has toggles */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    aria-label="Menu"
                    data-testid="header-overflow-menu-trigger"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56" data-testid="header-overflow-menu-content">
                  <DropdownMenuLabel>Day</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setSelectedDay('yesterday')}>
                    {selectedDay === 'yesterday' ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 w-4" />}
                    Yesterday
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedDay('today')}>
                    {selectedDay === 'today' ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 w-4" />}
                    Today
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Scope</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setScope('ads')}>
                    {scope === 'ads' ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 w-4" />}
                    ADS ONLY
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setScope('all')}>
                    {scope === 'all' ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 w-4" />}
                    ALL TRAFFIC
                  </DropdownMenuItem>
                  {role === 'admin' && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setSettingsOpen(true)}
                        data-testid="menu-item-settings"
                      >
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Settings dialog (opened from menu) */}
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogContent className="max-h-[80vh] overflow-y-auto">
              <DialogHeader className="mb-4">
                <DialogTitle>Settings</DialogTitle>
              </DialogHeader>
              <CommandCenterP0Panel siteId={siteId} />
            </DialogContent>
          </Dialog>

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
        <QualificationQueue siteId={siteId} range={queueRange} scope={scope} />

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
