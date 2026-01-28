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
import './reset.css';

interface DashboardShellProps {
  siteId: string;
  siteName?: string;
  siteDomain?: string;
}

export function DashboardShell({ siteId, siteName, siteDomain }: DashboardShellProps) {
  const [day, setDay] = useState<'yesterday' | 'today'>('today');

  const range = useMemo(() => {
    const { fromIso, toIso } = getTodayTrtUtcRange();
    if (day === 'today') return { fromIso, toIso };
    const fromMs = new Date(fromIso).getTime() - 24 * 60 * 60 * 1000;
    const toMs = new Date(toIso).getTime() - 24 * 60 * 60 * 1000;
    return { fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
  }, [day]);

  const { stats, loading } = useCommandCenterP0Stats(siteId, range);
  const captured = loading ? '…' : String(stats?.sealed ?? 0);
  const filtered = loading ? '…' : String(stats?.junk ?? 0);
  const saved = loading ? '…' : `${(stats?.estimated_budget_saved ?? 0).toLocaleString()} ${stats?.currency || ''}`.trim();

  return (
    <div className="om-dashboard-reset min-h-screen bg-muted/30">
      {/* Tactical Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            {/* Brand */}
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {siteName || siteDomain || 'OpsMantik'}
              </div>
              <div className="text-sm text-muted-foreground truncate">Hunter Terminal</div>
            </div>

            {/* Day toggle */}
            <div className="inline-flex items-center rounded-md border border-border bg-background">
              <button
                type="button"
                onClick={() => setDay('yesterday')}
                className={cn(
                  'px-3 py-1.5 text-sm tabular-nums',
                  'first:rounded-l-md last:rounded-r-md',
                  day === 'yesterday'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
                aria-pressed={day === 'yesterday'}
              >
                Yesterday
              </button>
              <button
                type="button"
                onClick={() => setDay('today')}
                className={cn(
                  'px-3 py-1.5 text-sm tabular-nums',
                  'first:rounded-l-md last:rounded-r-md',
                  day === 'today'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
                aria-pressed={day === 'today'}
              >
                Today
              </button>
            </div>

            {/* Settings -> Command Center modal */}
            <Dialog>
              <DialogTrigger>
                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Settings">
                  <Settings className="h-5 w-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[80vh] overflow-y-auto">
                <DialogHeader className="mb-4">
                  <DialogTitle>Command Center</DialogTitle>
                </DialogHeader>
                <CommandCenterP0Panel siteId={siteId} />
              </DialogContent>
            </Dialog>
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
        <QualificationQueue siteId={siteId} />

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
