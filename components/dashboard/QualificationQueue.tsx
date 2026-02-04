'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { HunterIntent, HunterIntentLite } from '@/lib/types/hunter';
import { LazySessionDrawer } from '@/components/dashboard/lazy-session-drawer';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { cn, formatTimestamp } from '@/lib/utils';
import { strings } from '@/lib/i18n/en';
import { HunterCard } from './HunterCard';
import { useIntentQualification } from '@/lib/hooks/use-intent-qualification';
import { useSiteConfig } from '@/lib/hooks/use-site-config';
import { SealModal } from './SealModal';
import { CheckCircle2, MessageCircle, Phone, FileText, XOctagon } from 'lucide-react';

export interface QualificationQueueProps {
  siteId: string;
  range: { day: 'today' | 'yesterday'; fromIso: string; toIso: string };
}

type RpcIntentRow = Record<string, unknown>;

function parseHunterIntentsFull(data: unknown): HunterIntent[] {
  if (!data) return [];
  let rows: RpcIntentRow[] = [];

  const raw = data;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    if (raw.length === 1 && Array.isArray(raw[0])) {
      rows = raw[0] as RpcIntentRow[];
    } else if (typeof raw[0] === 'string') {
      rows = raw
        .map((item: unknown): RpcIntentRow | null => {
          try {
            return (typeof item === 'string' ? JSON.parse(item) : item) as RpcIntentRow | null;
          } catch {
            return null;
          }
        })
        .filter((r): r is RpcIntentRow => r != null);
    } else {
      rows = raw as RpcIntentRow[];
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const arr = (obj.data ?? obj.rows ?? obj.intents) as unknown[];
    if (Array.isArray(arr)) rows = arr as RpcIntentRow[];
  }

  // Basic shape validation: need id for card key
  return rows.filter((r) => r != null && r.id != null).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    intent_action: r.intent_action ?? null,
    // Lite list may provide 'summary' instead of full intent_target
    intent_target: (r.intent_target ?? (r as any).summary) ?? null,
    intent_page_url: r.intent_page_url ?? null,
    page_url: r.page_url ?? r.intent_page_url ?? null,
    matched_session_id: r.matched_session_id ?? null,
    lead_score: r.lead_score ?? null,
    status: r.status ?? null,
    click_id: r.click_id ?? null,
    intent_stamp: r.intent_stamp ?? null,

    // Intel
    utm_term: r.utm_term ?? null,
    utm_campaign: r.utm_campaign ?? null,
    utm_source: r.utm_source ?? null,
    matchtype: r.matchtype ?? null,

    // Geo/Device
    city: r.city ?? null,
    district: r.district ?? null,
    device_type: r.device_type ?? null,
    device_os: r.device_os ?? null,
    ads_network: r.ads_network ?? null,
    ads_placement: r.ads_placement ?? null,

    // AI/Risk
    risk_level: r.risk_level ?? null,
    risk_reasons: Array.isArray(r.risk_reasons) ? r.risk_reasons : null,
    ai_score: typeof r.ai_score === 'number' ? r.ai_score : null,
    ai_summary: typeof r.ai_summary === 'string' ? r.ai_summary : null,
    ai_tags: Array.isArray(r.ai_tags) ? r.ai_tags : null,
    total_duration_sec: typeof r.total_duration_sec === 'number' ? r.total_duration_sec : null,
    estimated_value: typeof r.estimated_value === 'number' ? r.estimated_value : null,
    currency: r.currency ?? null,

    // OCI
    oci_stage: r.oci_stage ?? null,
    oci_status: r.oci_status ?? null,

    // Evidence
    attribution_source: r.attribution_source ?? null,
    gclid: r.gclid ?? null,
    wbraid: r.wbraid ?? null,
    gbraid: r.gbraid ?? null,
    event_count: typeof r.event_count === 'number' ? r.event_count : null,

    // Session-based action evidence (single card)
    phone_clicks: typeof (r as any).phone_clicks === 'number' ? (r as any).phone_clicks : null,
    whatsapp_clicks: typeof (r as any).whatsapp_clicks === 'number' ? (r as any).whatsapp_clicks : null,

    // Traffic source (from sessions join)
    traffic_source: typeof (r as any).traffic_source === 'string' ? (r as any).traffic_source : null,
    traffic_medium: typeof (r as any).traffic_medium === 'string' ? (r as any).traffic_medium : null,
  })) as HunterIntent[];
}

function parseHunterIntentsLite(data: unknown): HunterIntentLite[] {
  if (!data) return [];
  let rows: RpcIntentRow[] = [];

  const raw = data;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    if (raw.length === 1 && Array.isArray(raw[0])) {
      rows = raw[0] as RpcIntentRow[];
    } else if (typeof raw[0] === 'string') {
      rows = raw
        .map((item: unknown): RpcIntentRow | null => {
          try {
            return (typeof item === 'string' ? JSON.parse(item) : item) as RpcIntentRow | null;
          } catch {
            return null;
          }
        })
        .filter((r): r is RpcIntentRow => r != null);
    } else {
      rows = raw as RpcIntentRow[];
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const arr = (obj.data ?? obj.rows ?? obj.intents) as unknown[];
    if (Array.isArray(arr)) rows = arr as RpcIntentRow[];
  }

  return rows
    .filter((r) => r != null && r.id != null && r.created_at != null)
    .map((r) => ({
      id: String(r.id),
      created_at: String(r.created_at),
      status: (r.status as string | null | undefined) ?? null,
      matched_session_id: (r.matched_session_id as string | null | undefined) ?? null,
      intent_action: (r.intent_action as string | null | undefined) ?? null,
      summary: ((r as any).summary as string | null | undefined) ?? null,

      // Session-based action evidence (from get_recent_intents_lite_v1)
      phone_clicks: typeof (r as any).phone_clicks === 'number' ? (r as any).phone_clicks : null,
      whatsapp_clicks: typeof (r as any).whatsapp_clicks === 'number' ? (r as any).whatsapp_clicks : null,
      intent_events: typeof (r as any).intent_events === 'number' ? (r as any).intent_events : null,

      // Traffic source (from sessions join)
      traffic_source: typeof (r as any).traffic_source === 'string' ? (r as any).traffic_source : null,
      traffic_medium: typeof (r as any).traffic_medium === 'string' ? (r as any).traffic_medium : null,
    })) as HunterIntentLite[];
}

function ActiveDeckCard({
  siteId,
  intent,
  onOpenDetails,
  onOptimisticRemove,
  onQualified,
  onSkip,
  onSealDeal,
  pushToast,
  pushHistoryRow,
}: {
  siteId: string;
  intent: HunterIntent; // full intent preferred for the heavy HunterCard view
  onOpenDetails: (callId: string) => void;
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
  const { qualify, saving } = useIntentQualification(siteId, intent.id, intent.matched_session_id ?? null);

  const fireQualify = (params: { score: 0 | 1 | 2 | 3 | 4 | 5; status: 'confirmed' | 'junk' }) => {
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
    onOptimisticRemove(id);
    pushHistoryRow({
      id,
      status: 'junk',
      intent_action: intent.intent_action ?? null,
      identity: intent.intent_target ?? null,
    });
    pushToast('danger', 'Trash taken out.');
    // Junk should be score=0 (0-100 lead_score = 0) to avoid polluting OCI value logic.
    fireQualify({ score: 0, status: 'junk' });
  };

  return (
    <div className={cn(saving && 'opacity-60 pointer-events-none')}>
      <div
        onClickCapture={(e) => {
          const el = e.target as HTMLElement | null;
          // Don't open drawer when clicking action buttons inside the card.
          if (el && (el.closest('button') || el.getAttribute('role') === 'button')) return;
          onOpenDetails(intent.id);
        }}
      >
        <HunterCard
          intent={intent}
          traffic_source={(intent as any).traffic_source ?? null}
          traffic_medium={(intent as any).traffic_medium ?? null}
          onSeal={({ id, stars }) => handleSeal({ id, stars })}
          onSealDeal={onSealDeal}
          onJunk={({ id, stars }) => handleJunk({ id, stars })}
          onSkip={() => onSkip()}
        />
      </div>
    </div>
  );
}

function LiteDeckCard({
  intent,
  onOpenDetails,
  onSkip,
}: {
  intent: HunterIntentLite;
  onOpenDetails: (callId: string) => void;
  onSkip: () => void;
}) {
  const action = (intent.intent_action || 'intent').toString();
  const summary = intent.summary || 'Loading details…';
  const phoneClicks = typeof intent.phone_clicks === 'number' ? intent.phone_clicks : 0;
  const waClicks = typeof intent.whatsapp_clicks === 'number' ? intent.whatsapp_clicks : 0;
  const actionsLine =
    (phoneClicks > 0 || waClicks > 0)
      ? [
          phoneClicks > 0 ? `${phoneClicks}× phone` : null,
          waClicks > 0 ? `${waClicks}× WhatsApp` : null,
        ].filter(Boolean).join(' · ')
      : null;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
        onClick={() => onOpenDetails(intent.id)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
            {action}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
            {formatTimestamp(intent.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} TRT
          </div>
        </div>
        <div className="mt-2 text-sm font-medium truncate">{summary}</div>
        <div className="mt-2 text-xs text-muted-foreground">
          {actionsLine || 'Fetching details…'}
        </div>
      </button>

      <div className="p-3 pt-0">
        <div className="grid grid-cols-3 gap-2 w-full">
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-slate-200 font-bold text-[11px]"
            disabled
            title="Loading details…"
          >
            JUNK
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-slate-200 font-bold text-[11px]"
            onClick={() => onSkip()}
          >
            SKIP
          </Button>
          <Button
            size="sm"
            className="h-9 bg-emerald-600 text-white font-black text-[11px]"
            disabled
            title="Loading details…"
          >
            SEAL
          </Button>
        </div>
      </div>
    </div>
  );
}

export const QualificationQueue: React.FC<QualificationQueueProps> = ({ siteId, range }) => {
  const { bountyChips, currency: siteCurrency } = useSiteConfig(siteId);
  const [intents, setIntents] = useState<HunterIntentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<HunterIntent | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, HunterIntent>>({});
  const [sealModalOpen, setSealModalOpen] = useState(false);
  const [intentForSeal, setIntentForSeal] = useState<HunterIntent | null>(null);
  const { qualify: qualifyModalIntent } = useIntentQualification(
    siteId,
    intentForSeal?.id ?? '',
    intentForSeal?.matched_session_id ?? null
  );
  const [sessionEvidence, setSessionEvidence] = useState<
    Record<string, { city?: string | null; district?: string | null; device_type?: string | null }>
  >({});
  // Holistic View: always ALL traffic
  const effectiveAdsOnly = false;

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

  const fetchIntentDetails = useCallback(async (callId: string): Promise<HunterIntent | null> => {
    if (!callId) return null;
    if (detailsById[callId]) return detailsById[callId];
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc('get_intent_details_v1', {
        p_site_id: siteId,
        p_call_id: callId,
      });
      if (rpcError) return null;
      // get_intent_details_v1 returns a single jsonb object
      const rows = parseHunterIntentsFull(data ? [data as any] : []);
      const full = rows[0] || null;
      if (!full) return null;
      setDetailsById((prev) => ({ ...prev, [callId]: full }));
      return full;
    } catch {
      // ignore
    }
    return null;
  }, [detailsById, siteId]);

  const fetchUnscoredIntents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const supabase = createClient();

      async function fetchRange(): Promise<HunterIntentLite[]> {
        let data: unknown = null;
        // 1) Lite RPC (default limit 100) — cheap list payload
        const lite = await supabase.rpc('get_recent_intents_lite_v1', {
          p_site_id: siteId,
          p_date_from: range.fromIso,
          p_date_to: range.toIso,
          p_limit: 100,
          p_ads_only: false,
        });
        data = lite.data;
        const liteErr = lite.error;

        // Fallback: if lite RPC doesn't exist in older DBs
        const liteMsg = String(liteErr?.message || liteErr?.details || '').toLowerCase();
        if (liteErr && (liteMsg.includes('not found') || liteMsg.includes('does not exist'))) {
          // v1 uses since + minutes; derive minutes from range so Today/Yesterday both respect absolute range
          const fromMs = new Date(range.fromIso).getTime();
          const toMs = new Date(range.toIso).getTime();
          const minutesLookback = Math.max(1, Math.round((toMs - fromMs) / (60 * 1000)));
          const v1 = await supabase.rpc('get_recent_intents_v1', {
            p_site_id: siteId,
            p_since: range.fromIso,
            p_minutes_lookback: minutesLookback,
            p_limit: 100,
            p_ads_only: false,
          });
          data = v1.data;
          if (v1.error) throw v1.error;
        } else if (liteErr) {
          throw liteErr;
        }

        // Parse to LITE list items (even if fallback v1 returned heavier rows)
        const rows = parseHunterIntentsLite(data);
        // Range contract is half-open: [from, to) where to = next day start for "today" in TRT.
        const fromMs = new Date(range.fromIso).getTime();
        const toMs = new Date(range.toIso).getTime();

        return rows.filter((r) => {
          const ts = new Date(r.created_at || 0).getTime();
          if (!Number.isFinite(ts)) return false;
          // Status filter: pending only
          const s = (r.status || '').toLowerCase();
          const isPending = !s || s === 'intent';
          return isPending && ts >= fromMs && ts < toMs;
        });
      }

      const rows = await fetchRange();

      setIntents(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load intents');
    } finally {
      setLoading(false);
    }
  }, [range.fromIso, range.toIso, siteId]);

  const top = intents[0] || null;
  const next = intents[1] || null;

  // Lazy-load full details for the ACTIVE (top) card only
  useEffect(() => {
    if (!top?.id) return;
    void fetchIntentDetails(top.id);
  }, [fetchIntentDetails, top?.id]);

  const queueMeta = (
    <>
      <div
        data-testid="queue-range"
        data-day={range.day}
        data-from={range.fromIso}
        data-to={range.toIso}
        data-ads-only="0"
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
    // Holistic View: always ALL traffic
    { adsOnly: false }
  );

  const handleQualified = useCallback(() => {
    // Intent was qualified, refresh the list
    fetchUnscoredIntents();
  }, [fetchUnscoredIntents]);

  const handleCloseDrawer = useCallback(() => {
    setSelectedIntent(null);
  }, []);

  const openDrawerWithLazyDetails = useCallback(async (callId: string) => {
    const full = await fetchIntentDetails(callId);
    if (!full) return;
    setSelectedIntent(full);
  }, [fetchIntentDetails]);

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
              {range.day === 'yesterday' ? strings.queueEmptyYesterday : strings.queueEmptyTitle}
            </h3>
            <p className="text-muted-foreground max-w-md">
              {range.day === 'yesterday' ? strings.queueEmptyYesterdayDesc : strings.queueEmptyTodayDesc}
            </p>
            <p className="text-muted-foreground text-xs mt-2 max-w-md">
              {strings.queueEmptyUseRefresh}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchUnscoredIntents()}
              className="mt-4"
            >
              <Icons.refresh className="w-4 h-4 mr-2" />
              {strings.refresh}
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
              intent_action: selectedIntent.intent_action ?? null,
              intent_target: selectedIntent.intent_target ?? null,
              intent_page_url: selectedIntent.intent_page_url ?? null,
              intent_stamp: null,
              matched_session_id: selectedIntent.matched_session_id,
              lead_score: selectedIntent.lead_score ?? null,
              status: selectedIntent.status ?? null,
              click_id: selectedIntent.click_id ?? null,
            }}
            onClose={handleCloseDrawer}
          />
        )}
      </>
    );
  }

  const mergedTop: HunterIntent | null = top?.id && detailsById[top.id]
    ? (() => {
        const detail = detailsById[top.id];
        const sid = detail.matched_session_id;
        return {
          ...detail,
          ...(sid ? sessionEvidence[sid] : {}),
        };
      })()
    : null;

  const mergedNext: HunterIntentLite | null = next
    ? {
      ...next,
      // keep existing lightweight session evidence (optional)
      matched_session_id: next.matched_session_id ?? null,
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

          {mergedTop ? (
            <div className="relative z-10 transition-all duration-200">
              <ActiveDeckCard
                siteId={siteId}
                intent={mergedTop}
                onOpenDetails={(callId) => {
                  void openDrawerWithLazyDetails(callId);
                }}
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
          ) : top ? (
            <div className="relative z-10 transition-all duration-200">
              <LiteDeckCard
                intent={top}
                onOpenDetails={(callId) => {
                  void openDrawerWithLazyDetails(callId);
                }}
                onSkip={rotateSkip}
              />
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="tabular-nums">{intents.length} in queue</div>
          {mergedTop && (
            <div className="tabular-nums" suppressHydrationWarning>
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
                        <div className="text-xs tabular-nums text-muted-foreground w-[64px] shrink-0" suppressHydrationWarning>
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
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-b from-transparent to-background" />
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
          currency={siteCurrency}
          chipValues={bountyChips}
          onConfirm={async (saleAmount, currency, leadScore) => {
            const res = await fetch(`/api/calls/${intentForSeal.id}/seal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sale_amount: saleAmount ?? null,
                currency,
                lead_score: leadScore * 20,
              }),
            });
            if (!res.ok) {
              const j = await res.json().catch(() => ({}));
              throw new Error((j as { error?: string }).error || res.statusText);
            }
          }}
          onJunk={async () => {
            const result = await qualifyModalIntent({ score: 0, status: 'junk' });
            if (!result.success) throw new Error(result.error);
          }}
          onSuccess={() => {
            optimisticRemove(intentForSeal.id);
            pushHistoryRow({
              id: intentForSeal.id,
              status: 'confirmed',
              intent_action: intentForSeal.intent_action ?? null,
              identity: intentForSeal.intent_target ?? null,
            });
            pushToast('success', strings.sealModalDealSealed);
            setSealModalOpen(false);
            setIntentForSeal(null);
            handleQualified();
          }}
          onJunkSuccess={() => {
            optimisticRemove(intentForSeal.id);
            pushHistoryRow({
              id: intentForSeal.id,
              status: 'junk',
              intent_action: intentForSeal.intent_action ?? null,
              identity: intentForSeal.intent_target ?? null,
            });
            pushToast('success', strings.sealModalMarkedJunk);
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
            intent_action: selectedIntent.intent_action ?? null,
            intent_target: selectedIntent.intent_target ?? null,
            intent_page_url: selectedIntent.intent_page_url ?? null,
            intent_stamp: selectedIntent.intent_stamp ?? null,
            matched_session_id: selectedIntent.matched_session_id,
            lead_score: selectedIntent.lead_score ?? null,
            status: selectedIntent.status ?? null,
            click_id: selectedIntent.click_id ?? null,
          }}
          onClose={handleCloseDrawer}
        />
      )}
    </>
  );
};
