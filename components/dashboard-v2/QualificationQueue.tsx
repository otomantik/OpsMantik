'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import type { IntentForQualification } from './IntentQualificationCard';
import { LazySessionDrawer } from '@/components/dashboard/lazy-session-drawer';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { cn, formatTimestamp } from '@/lib/utils';
import { HunterCard } from './HunterCard';
import { useIntentQualification } from '@/lib/hooks/use-intent-qualification';
import { CheckCircle2, MessageCircle, Phone, FileText, XOctagon } from 'lucide-react';

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
  const [sessionEvidence, setSessionEvidence] = useState<Record<string, { city?: string | null; district?: string | null }>>({});

  const [history, setHistory] = useState<
    Array<{
      id: string;
      at: string;
      status: 'confirmed' | 'junk';
      intent_action: string | null;
      identity: string | null;
    }>
  >([]);

  const [toast, setToast] = useState<null | { kind: 'success' | 'danger'; text: string }>(null);

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

  const top = intents[0] || null;
  const next = intents[1] || null;

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
            <h3 className="text-xl font-semibold mb-2">Mission Accomplished</h3>
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

  function pushToast(kind: 'success' | 'danger', text: string) {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 1400);
  }

  function pushHistoryRow(row: { id: string; status: 'confirmed' | 'junk'; intent_action: string | null; identity: string | null }) {
    setHistory((prev) => [
      { ...row, at: new Date().toISOString() },
      ...prev,
    ].slice(0, 12));
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

  const rotateSkip = useCallback(() => {
    setIntents((prev) => {
      if (prev.length <= 1) return prev;
      const [first, ...rest] = prev;
      return [...rest, first];
    });
  }, []);

  function iconForAction(a: string | null) {
    const t = (a || '').toLowerCase();
    if (t === 'whatsapp') return MessageCircle;
    if (t === 'phone') return Phone;
    if (t === 'form') return FileText;
    return Icons.circleDot;
  }

  function statusBadge(status: 'confirmed' | 'junk') {
    if (status === 'confirmed') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-3 w-3" />
          Sealed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
        <XOctagon className="h-3 w-3" />
        Junk
      </span>
    );
  }

  function ActiveDeckCard({ intent }: { intent: IntentForQualification }) {
    const { qualify, saving } = useIntentQualification(siteId, intent.id);

    const handleSeal = async ({ id, stars }: { id: string; stars: number }) => {
      const s = Math.min(5, Math.max(1, Number(stars || 0))) as 1 | 2 | 3 | 4 | 5;
      // Optimistic: remove from deck immediately
      setIntents((prev) => prev.filter((x) => x.id !== id));
      pushHistoryRow({ id, status: 'confirmed', intent_action: intent.intent_action ?? null, identity: intent.intent_target ?? null });
      pushToast('success', 'Lead captured.');
      await qualify({ score: s, status: 'confirmed' });
      handleQualified();
    };

    const handleJunk = async ({ id, stars }: { id: string; stars: number }) => {
      const s = Math.min(5, Math.max(1, Number(stars || 0))) as 1 | 2 | 3 | 4 | 5;
      setIntents((prev) => prev.filter((x) => x.id !== id));
      pushHistoryRow({ id, status: 'junk', intent_action: intent.intent_action ?? null, identity: intent.intent_target ?? null });
      pushToast('danger', 'Trash taken out.');
      await qualify({ score: s, status: 'junk' });
      handleQualified();
    };

    return (
      <div className={cn(saving && 'opacity-60 pointer-events-none')}>
        <HunterCard
          intent={{
            id: intent.id,
            intent_action: intent.intent_action ?? null,
            intent_target: intent.intent_target ?? null,
            created_at: intent.created_at,
            intent_page_url: intent.intent_page_url ?? null,
            // best-effort: pass through if available in future RPCs
            utm_term: (intent as any)?.utm_term ?? null,
            utm_campaign: (intent as any)?.utm_campaign ?? null,
            risk_level: intent.risk_level ?? null,
          }}
          onSeal={({ id, stars }) => handleSeal({ id, stars })}
          onJunk={({ id, stars }) => handleJunk({ id, stars })}
          onSkip={() => rotateSkip()}
        />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {/* lightweight toast */}
        {toast && (
          <div
            className={cn(
              'rounded-lg border px-3 py-2 text-sm font-medium',
              toast.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-800'
            )}
          >
            {toast.text}
          </div>
        )}

        {/* Deck */}
        <div className="relative">
          {mergedNext && (
            <div
              className={cn(
                'pointer-events-none absolute left-0 right-0',
                'scale-95 opacity-50 translate-y-4',
                'transition-all duration-200'
              )}
              aria-hidden
            >
              <HunterCard
                intent={{
                  id: mergedNext.id,
                  intent_action: mergedNext.intent_action ?? null,
                  intent_target: mergedNext.intent_target ?? null,
                  created_at: mergedNext.created_at,
                  intent_page_url: mergedNext.intent_page_url ?? null,
                  utm_term: (mergedNext as any)?.utm_term ?? null,
                  utm_campaign: (mergedNext as any)?.utm_campaign ?? null,
                  risk_level: mergedNext.risk_level ?? null,
                }}
                onSeal={() => {}}
                onJunk={() => {}}
                onSkip={() => {}}
              />
            </div>
          )}

          {mergedTop && (
            <div className="relative z-10 transition-all duration-200">
              <ActiveDeckCard intent={mergedTop} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="tabular-nums">{intents.length} in queue</div>
          {mergedTop && (
            <div className="tabular-nums">
              {formatTimestamp(mergedTop.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} TRT
            </div>
          )}
          <Button variant="ghost" size="sm" className="h-9" onClick={() => fetchUnscoredIntents()}>
            <Icons.refresh className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Kill Feed */}
        <div className="relative rounded-lg border border-border bg-background p-3">
          <div className="text-sm font-medium">Kill Feed</div>
          <div className="mt-2 relative max-h-44 overflow-hidden">
            <div className="space-y-2">
              {history.length === 0 ? (
                <div className="text-sm text-muted-foreground">No actions yet.</div>
              ) : (
                history.map((h, idx) => {
                  const Icon = iconForAction(h.intent_action);
                  const faded = idx >= 7;
                  return (
                    <div
                      key={`${h.id}-${h.at}`}
                      className={cn(
                        'flex items-center justify-between gap-3',
                        faded && 'opacity-60'
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="text-xs tabular-nums text-muted-foreground w-[64px] shrink-0">
                          {formatTimestamp(h.at, { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="text-sm font-medium tabular-nums truncate">
                          {h.identity || '—'}
                        </div>
                      </div>
                      <div className="shrink-0">{statusBadge(h.status)}</div>
                    </div>
                  );
                })
              )}
            </div>

            {/* fade mask */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-background" />
          </div>
        </div>
      </div>

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
