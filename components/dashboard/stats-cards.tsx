'use client';

import { useDashboardStats } from '@/lib/hooks/use-dashboard-stats';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertCircle } from 'lucide-react';

interface StatsCardsProps {
  siteId?: string;
}

export function StatsCards({ siteId }: StatsCardsProps) {
  const { stats, loading, error, refetch } = useDashboardStats(siteId, 7);

  if (error) {
    return (
      <Card className="glass border-rose-500/50 bg-rose-500/5">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center">
          <AlertCircle className="w-8 h-8 text-rose-400 mb-2" />
          <p className="text-rose-200 font-mono text-sm mb-4">Error loading stats: {error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="bg-slate-800/60 border-slate-700/50 text-slate-200 hover:bg-slate-700/60"
          >
            <RefreshCw className="w-3 h-3 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Skeleton / Loading states
  const displayVisitors = loading ? '...' : (stats?.unique_visitors || 0).toLocaleString();
  const displayEvents = loading ? '...' : (stats?.total_events || 0).toLocaleString();
  const displayCalls = loading ? '...' : (stats?.total_calls || 0).toLocaleString();
  const displayConvRate = loading ? '...' : `${((stats?.conversion_rate || 0) * 100).toFixed(1)}%`;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Visitors - Emerald Neon */}
      <Card className="glass border-slate-800/50 neon-emerald">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-slate-300 uppercase tracking-wider">
            Total Visitors
          </CardTitle>
          <CardDescription className="text-xs font-mono text-slate-500 mt-1">
            Last 7 days
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <p className="text-4xl font-bold font-mono text-emerald-400 mb-1">
            {displayVisitors}
          </p>
          <p className="text-xs font-mono text-slate-500">Unique fingerprint base</p>
        </CardContent>
      </Card>

      {/* Total Events - Blue Neon */}
      <Card className="glass border-slate-800/50 neon-blue">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-slate-300 uppercase tracking-wider">
            Total Events
          </CardTitle>
          <CardDescription className="text-xs font-mono text-slate-500 mt-1">
            Last 7 days
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <p className="text-4xl font-bold font-mono text-blue-400 mb-1">
            {displayEvents}
          </p>
          <p className="text-xs font-mono text-slate-500">Tracked interactions</p>
        </CardContent>
      </Card>

      {/* Total Calls - Rose Neon */}
      <Card className="glass border-slate-800/50 neon-rose">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-slate-300 uppercase tracking-wider">
            Total Calls
          </CardTitle>
          <CardDescription className="text-xs font-mono text-slate-500 mt-1">
            Last 7 days
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <p className="text-4xl font-bold font-mono text-rose-400 mb-1">
            {displayCalls}
          </p>
          <p className="text-xs font-mono text-slate-500">Phone matches</p>
        </CardContent>
      </Card>

      {/* Conversion Rate - Indigo Neon */}
      <Card className="glass border-slate-800/50 neon-indigo">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-slate-300 uppercase tracking-wider">
            Conv. Rate
          </CardTitle>
          <CardDescription className="text-xs font-mono text-slate-500 mt-1">
            Visitors to Calls
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <p className="text-4xl font-bold font-mono text-indigo-400 mb-1">
            {displayConvRate}
          </p>
          <p className="text-xs font-mono text-slate-500">Confirmed match base</p>
        </CardContent>
      </Card>
    </div>
  );
}
