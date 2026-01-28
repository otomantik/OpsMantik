'use client';

import { useDashboardStats } from '@/lib/hooks/use-dashboard-stats';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertCircle } from 'lucide-react';

interface StatsCardsProps {
  siteId?: string;
  dateRange?: { from: Date; to: Date };
  adsOnly?: boolean;
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

  // Active status logic: within last 2 minutes
  // FIX 2: Defensive date parsing
  const isActive = stats?.last_event_at && (() => {
    try {
      const lastEventDate = new Date(stats.last_event_at);
      if (isNaN(lastEventDate.getTime())) return false;
      return new Date().getTime() - lastEventDate.getTime() < 120000;
    } catch {
      return false;
    }
  })();
  const hasNoActivity =
    !loading &&
    stats &&
    (stats.ads_sessions || 0) === 0 &&
    (stats.high_intent || 0) === 0 &&
    (stats.sealed || 0) === 0 &&
    (stats.total_events || 0) === 0;

  const displayAdsSessions = loading ? '...' : (stats?.ads_sessions || 0).toLocaleString();
  const displayHighIntent = loading ? '...' : (stats?.high_intent || 0).toLocaleString();
  const displaySealed = loading ? '...' : (stats?.sealed || 0).toLocaleString();
  const displayCvr = loading ? '...' : `${(((stats?.cvr || 0) as number) * 100).toFixed(1)}%`;

  // FIX 2: Defensive date parsing with error handling
  const formatLastSeen = (ts: string | null) => {
    if (!ts) return 'No activity';
    try {
      const date = new Date(ts);
      if (isNaN(date.getTime())) return 'Invalid date';
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Invalid date';
    }
  };

  return (
    <div className="space-y-4">
      {/* No Activity Helper - Only show when all zeros */}
      {hasNoActivity && (
        <div className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg">
          <p className="text-xs font-mono text-slate-600 text-center">
            No activity yet • Send events from your site to see metrics here
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Ads Sessions - Emerald */}
        <Card className="bg-white border border-slate-200 hover:border-emerald-300 transition-colors group shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-slate-600 uppercase tracking-widest flex items-center justify-between">
              <span>Ads Sessions</span>
              {isActive && (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-xs text-emerald-600">ACTIVE</span>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold font-mono text-emerald-600 tabular-nums group-hover:text-emerald-700 transition-colors">
                {displayAdsSessions}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              <p className="text-xs font-mono text-slate-600">Last activity: {formatLastSeen(stats?.last_event_at || null)}</p>
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">7d Range</p>
                <p className="text-xs font-mono text-slate-500 italic">Today vs 7d: Coming next</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* High Intent - Rose (phone+whatsapp clicks) */}
        <Card className="bg-white border border-slate-200 hover:border-rose-300 transition-colors group shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-slate-600 uppercase tracking-widest">
              High Intent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold font-mono text-rose-600 tabular-nums group-hover:text-rose-700 transition-colors">
                {displayHighIntent}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              <p className="text-xs font-mono text-slate-600" suppressHydrationWarning>Last call: {formatLastSeen(stats?.last_call_at || null)}</p>
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-slate-600">Phone + WhatsApp intents</p>
                <p className="text-xs font-mono text-slate-500 italic">Today vs 7d: Coming next</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sealed - Indigo */}
        <Card className="bg-white border border-slate-200 hover:border-indigo-300 transition-colors group shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-slate-600 uppercase tracking-widest">
              Sealed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold font-mono text-indigo-600 tabular-nums group-hover:text-indigo-700 transition-colors">
                {displaySealed}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              <p className="text-xs font-mono text-slate-600">Confirmed conversions</p>
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">7d Range</p>
                <p className="text-xs font-mono text-slate-500 italic">Today vs 7d: Coming next</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CVR - Blue */}
        <Card className="bg-white border border-slate-200 hover:border-blue-300 transition-colors group shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-slate-600 uppercase tracking-widest flex items-center justify-between">
              <span>CVR</span>
              <div className="flex items-center gap-1 cursor-help" title="Refetch data">
                <Button variant="ghost" size="icon" className="h-4 w-4 text-slate-600 hover:text-slate-800 p-0" onClick={() => refetch()}>
                  <RefreshCw className={`h-2.5 w-2.5 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold font-mono text-blue-600 tabular-nums group-hover:text-blue-700 transition-colors">
                {displayCvr}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              <p className="text-xs font-mono text-slate-600">Sealed / Ads Sessions</p>
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-slate-600">Ads-only KPI</p>
                <p className="text-xs font-mono text-slate-500 italic">Today vs 7d: Coming next</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
