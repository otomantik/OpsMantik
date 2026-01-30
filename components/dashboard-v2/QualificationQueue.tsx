'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { useSiteConfig } from '@/lib/hooks/use-site-config';
import { SealModal } from './SealModal';
import { CheckCircle2, MessageCircle, Phone, FileText, XOctagon } from 'lucide-react';

export interface QualificationQueueProps {
  siteId: string;
  range: { day: 'today' | 'yesterday'; fromIso: string; toIso: string };
  scope: 'ads' | 'all';
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

function ActiveDeckCard({
  siteId,
  intent,
  onOptimisticRemove,
  onQualified,
  onSkip,
  onSealDeal,
  pushToast,
  pushHistoryRow,
}: {
  siteId: string;
  intent: IntentForQualification;
  onOptimisticRemove: (id: string) => void;
  onQualified: () => void;
  onSkip: () => void;
  onSealDeal?: () => void;
  pushToast: (kind: 'success' | 'danger', text: string) => void;
  pushHistoryRow: (row: {
    id: string;
    status: 'confirmed' | 'junk';
    intent_action: string | null;
    identity: string | null;
  }) => void;
}) {
  // Hook must be called unconditionally (no conditional wrapper).
  const { qualify, saving } = useIntentQualification(siteId, intent.id);

  const fireQualify = (params: { score: 1 | 2 | 3 | 4 | 5; status: 'confirmed' | 'junk' }) => {
    // Fire-and-forget background update; keep UI native-fast.
    void qualify(params)
      .then(() => {
        onQualified();
      })
      .catch(() => {
        // Best-effort: refresh + show error toast; avoid re-inserting the card to keep flow snappy.
        pushToast('danger', 'Failed to update. Refetching…');
        onQualified();
      });
  };

  const handleSeal = ({ id, stars }: { id: string; stars: number }) => {
    const s = Math.min(5, Math.max(1, Number(stars || 0))) as 1 | 2 | 3 | 4 | 5;
    // Step 1: remove immediately
    onOptimisticRemove(id);
    // Step 2: toast + history immediately
    pushHistoryRow({
      id,
      status: 'confirmed',
      intent_action: intent.intent_action ?? null,
      identity: intent.intent_target ?? null,
    });
    pushToast('success', 'Lead captured.');
    // Step 3: async update in background
    fireQualify({ score: s, status: 'confirmed' });
  };

  const handleJunk = ({ id, stars }: { id: string; stars: number }) => {
    const s = Math.min(5, Math.max(1, Number(stars || 0))) as 1 | 2 | 3 | 4 | 5;
    onOptimisticRemove(id);
    pushHistoryRow({
      id,
      status: 'junk',
      intent_action: intent.intent_action ?? null,
      identity: intent.intent_target ?? null,
    });
    pushToast('danger', 'Trash taken out.');
    fireQualify({ score: s, status: 'junk' });
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
          utm_term: (intent as any)?.utm_term ?? null,
          utm_campaign: (intent as any)?.utm_campaign ?? null,
          risk_level: intent.risk_level ?? null,
          city: (intent as any)?.city ?? null,
          district: (intent as any)?.district ?? null,
          device_type: (intent as any)?.device_type ?? null,
          total_duration_sec: (intent as any)?.total_duration_sec ?? null,
          click_id: intent.click_id ?? null,
          matched_session_id: intent.matched_session_id ?? null,
          ai_score: intent.ai_score ?? null,
          ai_summary: intent.ai_summary ?? null,
          ai_tags: intent.ai_tags ?? null,
        }}
        onSeal={({ id, stars }) => handleSeal({ id, stars })}
        onSealDeal={onSealDeal}
        onJunk={({ id, stars }) => handleJunk({ id, stars })}
        onSkip={() => onSkip()}
      />
    </div>
  );
}

export const QualificationQueue: React.FC<QualificationQueueProps> = ({ siteId, range, scope }) => {
  const { bountyChips, currency: siteCurrency } = useSiteConfig(siteId);
  const [intents, setIntents] = useState<IntentForQualification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<IntentForQualification | null>(null);
  const [sealModalOpen, setSealModalOpen] = useState(false);
  const [intentForSeal, setIntentForSeal] = useState<IntentForQualification | null>(null);
  const [sessionEvidence, setSessionEvidence] = useState<
    Record<string, { city?: string | null; district?: string | null; device_type?: string | null }>
  >({});
  const rpcV2AvailableRef = useRef<boolean>(true);
  const [effectiveAdsOnly, setEffectiveAdsOnly] = useState<boolean>(true);

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
      // Prefer v2 (AI fields: ai_score, ai_summary, ai_tags); fallback to v1 if v2 not available
      const preferV2 =
        process.env.NEXT_PUBLIC_RPC_V2 !== '0' &&
        (typeof window === 'undefined' || window.localStorage?.getItem('opsmantik_rpc_v2') !== '0');

      async function fetchRange(adsOnly: boolean) {
        let data: unknown = null;
        let fetchError: any = null;

        if (preferV2 && rpcV2AvailableRef.current) {
          const v2 = await supabase.rpc('get_recent_intents_v2', {
            p_site_id: siteId,
            p_date_from: range.fromIso,
            p_date_to: range.toIso,
            p_limit: 500,
            p_ads_only: adsOnly,
          });
          data = v2.data;
          fetchError = v2.error;

          const msg = String(fetchError?.message || fetchError?.details || '');
          if (fetchError && (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('does not exist'))) {
            rpcV2AvailableRef.current = false;
          }
        } else {
          fetchError = { message: 'use_v1' };
        }

        if (fetchError) {
          // v1 uses since + minutes; derive minutes from range so Today/Yesterday both respect absolute range
          const fromMs = new Date(range.fromIso).getTime();
          const toMs = new Date(range.toIso).getTime();
          const minutesLookback = Math.max(1, Math.round((toMs - fromMs) / (60 * 1000)));
          const v1 = await supabase.rpc('get_recent_intents_v1', {
            p_site_id: siteId,
            p_since: range.fromIso,
            p_minutes_lookback: minutesLookback,
            p_limit: 500,
            p_ads_only: adsOnly,
          });
          data = v1.data;
          fetchError = v1.error;
        }

        if (fetchError) throw fetchError;

        const rows = parseRpcJsonbArray<any>(data);
        const fromMs = new Date(range.fromIso).getTime();
        const toMs = new Date(range.toIso).getTime();
        const inRange = rows.filter((r) => {
          const ts = new Date(r?.created_at || 0).getTime();
          if (!Number.isFinite(ts)) return false;
          return ts >= fromMs && ts <= toMs;
        });

        // Queue rule: show *pending human decision* intents.
        // lead_score can be auto-populated at match time; it should NOT hide rows.
        const pending = inRange.filter((r) => {
          const status = (r?.status ?? null) as string | null;
          const s = status ? String(status).toLowerCase() : null;
          return s === null || s === 'intent';
        });

        return pending as any[];
      }

      // Scope toggle is the source of truth:
      // - scope='ads' => strictly adsOnly=true
      // - scope='all' => adsOnly=false
      const adsOnly = scope === 'ads';
      const rows = await fetchRange(adsOnly);
      setEffectiveAdsOnly(adsOnly);

      setIntents(
        rows.map((r) => ({
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
          ai_score: typeof r.ai_score === 'number' ? r.ai_score : null,
          ai_summary: typeof r.ai_summary === 'string' ? r.ai_summary : null,
          ai_tags: Array.isArray(r.ai_tags) ? r.ai_tags : null,
        })) as IntentForQualification[]
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to load intents');
    } finally {
      setLoading(false);
    }
  }, [range.fromIso, range.toIso, siteId, scope]);

  const top = intents[0] || null;
  const next = intents[1] || null;

  const queueMeta = (
    <>
      <div
        data-testid="queue-range"
        data-day={range.day}
        data-from={range.fromIso}
        data-to={range.toIso}
        data-ads-only={effectiveAdsOnly ? '1' : '0'}
        className="sr-only"
      />
      <div data-testid="queue-top-created-at" className="sr-only">
        {top?.created_at || ''}
      </div>
    </>
  );

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
            device_type: row.device_type ?? null,
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

  const rotateSkip = useCallback(() => {
    setIntents((prev) => {
      if (prev.length <= 1) return prev;
      const [first, ...rest] = prev;
      return [...rest, first];
    });
  }, []);

  const optimisticRemove = useCallback((id: string) => {
    setIntents((prev) => {
      if (prev.length === 0) return prev;
      // Fast path: remove top card by slice (preferred UX)
      if (prev[0]?.id === id) return prev.slice(1);
      // Fallback: remove by id
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const pushToast = useCallback((kind: 'success' | 'danger', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 1400);
  }, []);

  const pushHistoryRow = useCallback(
    (row: { id: string; status: 'confirmed' | 'junk'; intent_action: string | null; identity: string | null }) => {
      setHistory((prev) => [{ ...row, at: new Date().toISOString() }, ...prev].slice(0, 12));
    },
    []
  );

  if (loading) {
    return (
      <>
        {queueMeta}
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
      </>
    );
  }

  if (error) {
    return (
      <>
        {queueMeta}
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
      </>
    );
  }

  if (intents.length === 0) {
    return (
      <>
        {queueMeta}
        <Card className="border-2 border-dashed border-border bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Icons.check className="w-16 h-16 text-green-500 mb-4" />
            <h3 className="text-xl font-semibold mb-2" data-testid="queue-empty-state">
              {range.day === 'yesterday' ? 'No data for yesterday' : 'Mission Accomplished'}
            </h3>
            <p className="text-muted-foreground max-w-md">
              {range.day === 'yesterday'
                ? 'No intents were found for yesterday in the selected TRT window.'
                : 'No pending intents to qualify. New intents from Google Ads will appear here automatically.'}
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

  function peekBorderClass(action: string | null | undefined) {
    const t = (action || '').toLowerCase();
    if (t === 'whatsapp') return 'border-l-4 border-green-500';
    if (t === 'phone') return 'border-l-4 border-blue-500';
    if (t === 'form') return 'border-l-4 border-purple-500';
    return 'border-l-4 border-border';
  }

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

  return (
    <>
      {queueMeta}
      <div className="space-y-3">
        {!effectiveAdsOnly && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Ads-only filter returned 0 rows. Showing all traffic for visibility.
          </div>
        )}
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
        <div className="relative min-h-[420px]">
          {/* Next card (peek): render a lightweight placeholder only (no text bleed). */}
          {mergedNext && (
            <div
              className={cn(
                'pointer-events-none absolute inset-0 -z-10',
                'scale-95 -translate-y-2',
                'transition-transform duration-200'
              )}
              aria-hidden
            >
              <div
                className={cn(
                  'h-full w-full rounded-lg border border-border bg-card shadow-sm',
                  peekBorderClass(mergedNext.intent_action)
                )}
              />
            </div>
          )}

          {mergedTop && (
            <div className="relative z-10 transition-all duration-200">
              <ActiveDeckCard
                siteId={siteId}
                intent={mergedTop}
                onOptimisticRemove={optimisticRemove}
                onQualified={handleQualified}
                onSkip={rotateSkip}
                onSealDeal={() => {
                  setIntentForSeal(mergedTop);
                  setSealModalOpen(true);
                }}
                pushToast={pushToast}
                pushHistoryRow={pushHistoryRow}
              />
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

      {/* Seal Modal (Casino Table) */}
      {intentForSeal && (
        <SealModal
          open={sealModalOpen}
          onOpenChange={(open) => {
            setSealModalOpen(open);
            if (!open) setIntentForSeal(null);
          }}
          callId={intentForSeal.id}
          siteId={siteId}
          currency={siteCurrency}
          chipValues={bountyChips}
          onConfirm={async (saleAmount, currency) => {
            const res = await fetch(`/api/calls/${intentForSeal.id}/seal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sale_amount: saleAmount, currency }),
            });
            if (!res.ok) {
              const j = await res.json().catch(() => ({}));
              throw new Error((j as { error?: string }).error || res.statusText);
            }
          }}
          onSuccess={() => {
            optimisticRemove(intentForSeal.id);
            pushHistoryRow({
              id: intentForSeal.id,
              status: 'confirmed',
              intent_action: intentForSeal.intent_action ?? null,
              identity: intentForSeal.intent_target ?? null,
            });
            pushToast('success', 'Deal sealed.');
            setSealModalOpen(false);
            setIntentForSeal(null);
            handleQualified();
          }}
          onError={(message) => {
            pushToast('danger', message);
          }}
        />
      )}

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
};
