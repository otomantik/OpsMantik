'use client';

import { useDashboardStats } from '@/lib/hooks/use-dashboard-stats';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertCircle } from 'lucide-react';

interface StatsCardsProps {
  siteId?: string;
}

interface StatsCardsProps {
  siteId?: string;
  dateRange?: { from: Date; to: Date };
}

export function StatsCards({ siteId, dateRange }: StatsCardsProps) {
  const { stats, loading, error, refetch } = useDashboardStats(siteId, undefined, dateRange);

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
  });

  if (error) {
    return (
      <Card className="glass border-rose-500/50 bg-rose-500/5">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="w-10 h-10 text-rose-400 mb-2" />
          <p className="text-rose-200 font-mono text-sm mb-4">Critical failure: {error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="bg-slate-800/60 border-slate-700/50 text-slate-200 hover:bg-slate-700/60"
          >
            <RefreshCw className="w-3 h-3 mr-2" />
            Retry Connection
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Active status logic: within last 2 minutes
  const isActive = stats?.last_event_at && (new Date().getTime() - new Date(stats.last_event_at).getTime() < 120000);
  const hasNoActivity = !loading && stats && stats.unique_visitors === 0 && stats.total_calls === 0 && stats.total_events === 0;

  const displayVisitors = loading ? '...' : (stats?.unique_visitors || 0).toLocaleString();
  const displayEvents = loading ? '...' : (stats?.total_events || 0).toLocaleString();
  const displayCalls = loading ? '...' : (stats?.total_calls || 0).toLocaleString();
  const displayConvRate = loading ? '...' : `${((stats?.conversion_rate || 0) * 100).toFixed(1)}%`;

  const formatLastSeen = (ts: string | null) => {
    if (!ts) return 'No activity';
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4">
      {/* No Activity Helper - Only show when all zeros */}
      {hasNoActivity && (
        <div className="px-4 py-2 bg-slate-800/30 border border-slate-700/30 rounded-lg">
          <p className="text-[11px] font-mono text-slate-400 text-center">
            No activity yet • Send events from your site to see metrics here
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Visitors - Emerald (Reach) */}
        <Card className="glass border-slate-800/50 hover:border-emerald-500/30 transition-colors group">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-mono text-slate-400 uppercase tracking-widest flex items-center justify-between">
              <span>Total Visitors</span>
              {isActive && (
                <div className="flex items-center gap-1.5 no-emerald-glow">
                  <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]"></div>
                  <span className="text-[9px] text-emerald-400">ACTIVE</span>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold font-mono text-emerald-400 group-hover:text-emerald-300 transition-colors">
                {displayVisitors}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              <p className="text-[10px] font-mono text-slate-500">Last activity: {formatLastSeen(stats?.last_event_at || null)}</p>
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-mono text-slate-600 bg-slate-800/40 px-1.5 py-0.5 rounded">7d Range</p>
                <p className="text-[9px] font-mono text-slate-600 italic">Today vs 7d: Coming next</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Calls - Rose (Intent) */}
        <Card className="glass border-slate-800/50 hover:border-rose-500/30 transition-colors group">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
              Total Calls
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold font-mono text-rose-400 group-hover:text-rose-300 transition-colors">
                {displayCalls}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              <p className="text-[10px] font-mono text-slate-500">Last call: {formatLastSeen(stats?.last_call_at || null)}</p>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-mono text-slate-500">Matched via Fingerprint</p>
                <p className="text-[9px] font-mono text-slate-600 italic">Today vs 7d: Coming next</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Conversion Rate - Indigo (Efficiency) */}
        <Card className="glass border-slate-800/50 hover:border-indigo-500/30 transition-colors group">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
              Conv. Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold font-mono text-indigo-400 group-hover:text-indigo-300 transition-colors">
                {displayConvRate}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              <p className="text-[10px] font-mono text-slate-500">Confirmed match rate</p>
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-mono text-slate-600 bg-slate-800/40 px-1.5 py-0.5 rounded">7d Range</p>
                <p className="text-[9px] font-mono text-slate-600 italic">Today vs 7d: Coming next</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Events - Blue (Engagement) */}
        <Card className="glass border-slate-800/50 hover:border-blue-500/30 transition-colors group">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-mono text-slate-400 uppercase tracking-widest flex items-center justify-between">
              <span>Total Events</span>
              <div className="flex items-center gap-1 cursor-help" title="Refetch data">
                <Button variant="ghost" size="icon" className="h-4 w-4 text-slate-600 hover:text-slate-400 p-0" onClick={() => refetch()}>
                  <RefreshCw className={`h-2.5 w-2.5 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold font-mono text-blue-400 group-hover:text-blue-300 transition-colors">
                {displayEvents}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              <p className="text-[10px] font-mono text-slate-500">Last activity: {formatLastSeen(stats?.last_event_at || null)}</p>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-mono text-slate-500">Atomic tracker hits</p>
                <p className="text-[9px] font-mono text-slate-600 italic">Today vs 7d: Coming next</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
