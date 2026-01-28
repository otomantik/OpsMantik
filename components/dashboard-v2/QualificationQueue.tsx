'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { IntentCard } from './cards/IntentCard';
import type { IntentForQualification } from './IntentQualificationCard';
import { LazySessionDrawer } from '@/components/dashboard/lazy-session-drawer';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { cn, formatTimestamp } from '@/lib/utils';

interface QualificationQueueProps {
  siteId: string;
}

function parseRpcJsonbArray<T>(data: unknown): T[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    if (data.length === 0) return [];
    if (typeof data[0] === 'object' && data[0] !== null && !Array.isArray(data[0])) {
      return data as T[];
    }
    if (typeof data[0] === 'string') {
      const out: T[] = [];
      for (const item of data as string[]) {
        try {
          const parsed = JSON.parse(item);
          if (parsed && typeof parsed === 'object') out.push(parsed as T);
        } catch {
          // ignore
        }
      }
      return out;
    }
  }
  return [];
}

export function QualificationQueue({ siteId }: QualificationQueueProps) {
  const [intents, setIntents] = useState<IntentForQualification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<IntentForQualification | null>(null);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  const [sessionEvidence, setSessionEvidence] = useState<Record<string, { city?: string | null; district?: string | null }>>({});

  const fetchUnscoredIntents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const supabase = createClient();

      // Source of truth: use the same RPC pipeline as LiveInbox to avoid schema/RLS drift.
      // Pull "today-like" window (up to 24h) then filter client-side to unscored.
      const { data, error: fetchError } = await supabase.rpc('get_recent_intents_v1', {
        p_site_id: siteId,
        p_since: null,
        p_minutes_lookback: 24 * 60,
        p_limit: 500,
        p_ads_only: true,
      });

      if (fetchError) {
        throw fetchError;
      }

      const rows = parseRpcJsonbArray<any>(data);
      const unscored = rows.filter((r) => {
        const status = (r?.status ?? null) as string | null;
        const leadScore = (r?.lead_score ?? null) as number | null;
        const statusOk = status === null || String(status).toLowerCase() === 'intent';
        const scoreOk = leadScore === null || Number(leadScore) === 0;
        return statusOk && scoreOk;
      });

      setIntents(
        unscored.map((r) => ({
          id: r.id,
          created_at: r.created_at,
          intent_action: r.intent_action,
          intent_target: r.intent_target,
          intent_page_url: r.intent_page_url,
          matched_session_id: r.matched_session_id,
          lead_score: r.lead_score ?? null,
          status: r.status ?? null,
          click_id: r.click_id ?? null,
          risk_level: r.risk_level ?? null,
          risk_reasons: Array.isArray(r.risk_reasons) ? r.risk_reasons : null,
          oci_stage: r.oci_stage ?? null,
          oci_status: r.oci_status ?? null,
          // Evidence fields (best-effort; may be absent depending on RPC/session join)
          attribution_source: r.attribution_source ?? null,
          gclid: r.gclid ?? null,
          wbraid: r.wbraid ?? null,
          gbraid: r.gbraid ?? null,
          total_duration_sec: typeof r.total_duration_sec === 'number' ? r.total_duration_sec : null,
          event_count: typeof r.event_count === 'number' ? r.event_count : null,
        })) as IntentForQualification[]
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to load intents');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  const visibleIntents = useMemo(() => {
    if (skippedIds.size === 0) return intents;
    return intents.filter((i) => !skippedIds.has(i.id));
  }, [intents, skippedIds]);

  const top = visibleIntents[0] || null;
  const next = visibleIntents[1] || null;

  // Fetch richer session evidence for the TOP card only (keeps UI snappy, avoids heavy fan-out)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!top?.matched_session_id) return;
      const sid = top.matched_session_id;
      if (sessionEvidence[sid]) return;

      try {
        const supabase = createClient();
        const { data, error: rpcError } = await supabase.rpc('get_session_details', {
          p_site_id: siteId,
          p_session_id: sid,
        });
        if (rpcError) return;
        const row = Array.isArray(data) ? data[0] : null;
        if (!row) return;
        if (cancelled) return;
        setSessionEvidence((prev) => ({
          ...prev,
          [sid]: {
            city: row.city ?? null,
            district: row.district ?? null,
          },
        }));
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [siteId, sessionEvidence, top?.matched_session_id]);

  // Initial fetch
  useEffect(() => {
    fetchUnscoredIntents();
  }, [fetchUnscoredIntents]);

  // Realtime updates: refetch when new intents arrive
  useRealtimeDashboard(
    siteId,
    {
      onCallCreated: () => {
        fetchUnscoredIntents();
      },
      onCallUpdated: () => {
        fetchUnscoredIntents();
      },
    },
    { adsOnly: true }
  );

  const handleQualified = useCallback(() => {
    // Intent was qualified, refresh the list
    fetchUnscoredIntents();
  }, [fetchUnscoredIntents]);

  const handleOpenSession = useCallback((intent: IntentForQualification) => {
    setSelectedIntent(intent);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedIntent(null);
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">
            Intent Qualification Queue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border border-rose-200 bg-rose-50">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Icons.alert className="w-10 h-10 text-rose-600 mb-2" />
          <p className="text-rose-800 text-sm mb-4">Failed to load intents: {error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchUnscoredIntents()}
            className="bg-background border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            <Icons.refresh className="w-3 h-3 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (intents.length === 0) {
    return (
      <>
        <Card className="border-2 border-dashed border-border bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Icons.check className="w-16 h-16 text-green-500 mb-4" />
            <h3 className="text-xl font-semibold mb-2">All Caught Up!</h3>
            <p className="text-muted-foreground max-w-md">
              No pending intents to qualify. New intents from Google Ads will appear here automatically.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchUnscoredIntents()}
              className="mt-4"
            >
              <Icons.refresh className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </CardContent>
        </Card>

        {/* Session Drawer */}
        {selectedIntent && selectedIntent.matched_session_id && (
          <LazySessionDrawer
            siteId={siteId}
            intent={{
              id: selectedIntent.id,
              created_at: selectedIntent.created_at,
              intent_action: selectedIntent.intent_action,
              intent_target: selectedIntent.intent_target,
              intent_page_url: selectedIntent.intent_page_url,
              intent_stamp: null,
              matched_session_id: selectedIntent.matched_session_id,
              lead_score: selectedIntent.lead_score,
              status: selectedIntent.status,
              click_id: selectedIntent.click_id,
            }}
            onClose={handleCloseDrawer}
          />
        )}
      </>
    );
  }

  const mergedTop: IntentForQualification | null = top
    ? {
        ...top,
        ...(top.matched_session_id ? sessionEvidence[top.matched_session_id] : {}),
      }
    : null;

  const mergedNext: IntentForQualification | null = next
    ? {
        ...next,
        ...(next.matched_session_id ? sessionEvidence[next.matched_session_id] : {}),
      }
    : null;

  return (
    <>
      <Card>
        <CardHeader className="py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold leading-none">Qualification Queue</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">
                Clear the stack — Seal or Junk. (Top card expanded)
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">
                {visibleIntents.length} Pending
              </Badge>
              {skippedIds.size > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => setSkippedIds(new Set())}
                  title="Show skipped"
                >
                  Show skipped ({skippedIds.size})
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => fetchUnscoredIntents()} title="Refresh">
                <Icons.refresh className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {/* Stacked cards */}
          <div className="relative">
            {/* Next card peeking */}
            {mergedNext && (
              <div
                className={cn(
                  'pointer-events-none absolute left-0 right-0',
                  'translate-y-6 scale-[0.985] opacity-90'
                )}
                aria-hidden
              >
                <IntentCard
                  siteId={siteId}
                  intent={mergedNext}
                  onQualified={handleQualified}
                  onOpenSession={() => handleOpenSession(mergedNext)}
                />
              </div>
            )}

            {/* Top card */}
            {mergedTop && (
              <div className="relative z-10">
                <IntentCard
                  siteId={siteId}
                  intent={mergedTop}
                  autoFocusPrimary
                  onSkip={() => {
                    setSkippedIds((prev) => new Set(prev).add(mergedTop.id));
                  }}
                  onQualified={handleQualified}
                  onOpenSession={() => handleOpenSession(mergedTop)}
                />
              </div>
            )}
          </div>

          {/* Small helper row */}
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <div>
              Tip: Use <span className="font-medium text-foreground">SEAL</span> or <span className="font-medium text-foreground">JUNK</span> to clear faster.
            </div>
            {mergedTop && (
              <div className="tabular-nums">
                {formatTimestamp(mergedTop.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} TRT
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Session Drawer */}
      {selectedIntent && selectedIntent.matched_session_id && (
        <LazySessionDrawer
          siteId={siteId}
          intent={{
            id: selectedIntent.id,
            created_at: selectedIntent.created_at,
            intent_action: selectedIntent.intent_action,
            intent_target: selectedIntent.intent_target,
            intent_page_url: selectedIntent.intent_page_url,
            intent_stamp: null,
            matched_session_id: selectedIntent.matched_session_id,
            lead_score: selectedIntent.lead_score,
            status: selectedIntent.status,
            click_id: selectedIntent.click_id,
          }}
          onClose={handleCloseDrawer}
        />
      )}
    </>
  );
}
