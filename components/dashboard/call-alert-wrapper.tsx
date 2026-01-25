'use client';

import { useMemo } from 'react';
import { CallAlertComponent } from './call-alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCallMonitorData, Call } from '@/lib/hooks/use-call-monitor-data';

interface CallAlertWrapperProps {
  siteId?: string;
}

export function CallAlertWrapper({ siteId }: CallAlertWrapperProps = {}) {
  // Use extracted hook for data fetching and realtime subscriptions
  const { calls, dismissed, newMatchIds, isLoading, error, onDismiss } = useCallMonitorData(siteId);

  // Filter out dismissed calls
  const visibleCalls = useMemo(() => 
    calls.filter((call) => !dismissed.has(call.id)), 
    [calls, dismissed]
  );

  // Show error if data fetch failed
  if (error) {
    return (
      <Card className="glass border-slate-800/50 border-2 border-red-800/50 shadow-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-mono text-red-400">⚠️ ERROR LOADING CALLS</CardTitle>
          <CardDescription className="font-mono text-xs text-slate-400 mt-1">
            {error.message}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <Card className="glass border-slate-800/50 shadow-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-mono text-slate-200">CALL MONITOR</CardTitle>
          <CardDescription className="font-mono text-xs text-slate-400 mt-1">
            Loading...
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-slate-500 font-mono text-sm text-center py-4">Loading calls...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass border-slate-800/50 shadow-2xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-mono text-slate-200">CALL MONITOR</CardTitle>
            <CardDescription className="font-mono text-xs text-slate-400 mt-1">
              Live phone matches
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-xs font-mono text-emerald-400">ACTIVE</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {visibleCalls.length === 0 ? (
          <div className="text-center py-8">
            <p className="font-mono text-sm text-slate-500">No calls detected</p>
            <p className="font-mono text-xs text-slate-600 mt-2">Awaiting activity...</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {visibleCalls.map((call) => (
              <CallAlertComponent
                key={call.id}
                call={call}
                onDismiss={onDismiss}
                isNewMatch={newMatchIds.has(call.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
