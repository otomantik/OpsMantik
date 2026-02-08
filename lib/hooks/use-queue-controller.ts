'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { useIntentQualification } from '@/lib/hooks/use-intent-qualification';
import { useSiteConfig } from '@/lib/hooks/use-site-config';
import { strings } from '@/lib/i18n/en';
import type { HunterIntent, HunterIntentLite } from '@/lib/types/hunter';
import { parseHunterIntentsFull, parseHunterIntentsLite } from '@/components/dashboard/qualification-queue/parsers';
import type { ActivityRow } from '@/components/dashboard/qualification-queue/activity-log-inline';
import { logger } from '@/lib/logging/logger';

export type QueueRange = { day: 'today' | 'yesterday'; fromIso: string; toIso: string };

export type QueueToastState = null | { kind: 'success' | 'danger'; text: string };

export type QueueControllerState = {
  range: QueueRange | null;
  bountyChips: number[];
  siteCurrency: string;

  intents: HunterIntentLite[];
  loading: boolean;
  error: string | null;

  selectedIntent: HunterIntent | null;
  detailsById: Record<string, HunterIntent>;

  sealModalOpen: boolean;
  intentForSeal: HunterIntent | null;

  sessionEvidence: Record<string, { city?: string | null; district?: string | null; device_type?: string | null }>;

  history: ActivityRow[];
  restoringIds: Set<string>;
  toast: QueueToastState;

  top: HunterIntentLite | null;
  next: HunterIntentLite | null;
  mergedTop: HunterIntent | null;
  mergedNext: HunterIntentLite | null;
};

export type QueueControllerActions = {
  setRange: (range: QueueRange) => void;

  fetchUnscoredIntents: () => void;
  fetchKillFeed: () => void;

  handleQualified: () => void;

  openDrawerWithLazyDetails: (callId: string) => void;
  closeDrawer: () => void;

  rotateSkip: () => void;
  optimisticRemove: (id: string) => void;

  pushToast: (kind: 'success' | 'danger', text: string) => void;
  pushHistoryRow: (_row: { id: string; status: 'confirmed' | 'junk'; intent_action: string | null; identity: string | null }) => void;

  undoLastAction: (callId: string) => void;
  cancelDeal: (callId: string) => void;

  openSealModal: (intent: HunterIntent) => void;
  setSealModalOpen: (open: boolean) => void;
  clearSealIntent: () => void;

  onSealConfirm: (saleAmount: number | null, currency: string, leadScore: number) => Promise<void>;
  onSealJunk: () => Promise<void>;
  onSealSuccess: () => void;
  onSealJunkSuccess: () => void;
  onSealError: (message: string) => void;
};

export function useQueueController(siteId: string): { state: QueueControllerState; actions: QueueControllerActions } {
  const { bountyChips, currency: siteCurrency } = useSiteConfig(siteId);

  const [range, setRangeState] = useState<QueueRange | null>(null);

  const [intents, setIntents] = useState<HunterIntentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<HunterIntent | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, HunterIntent>>({});
  const [sealModalOpen, setSealModalOpen] = useState(false);
  const [intentForSeal, setIntentForSeal] = useState<HunterIntent | null>(null);
  const [sessionEvidence, setSessionEvidence] = useState<
    Record<string, { city?: string | null; district?: string | null; device_type?: string | null }>
  >({});

  // Holistic View: always ALL traffic (kept for parity even if unused directly)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const effectiveAdsOnly = false;

  const [history, setHistory] = useState<ActivityRow[]>([]);
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<QueueToastState>(null);

  const top = intents[0] || null;
  const next = intents[1] || null;

  const fetchIntentDetails = useCallback(
    async (callId: string): Promise<HunterIntent | null> => {
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
    },
    [detailsById, siteId]
  );

  const fetchKillFeed = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc('get_activity_feed_v1', {
        p_site_id: siteId,
        // Show more than 24h so "yesterday" actions remain undoable.
        p_hours_back: 72,
        p_limit: 50,
      });
      if (rpcError) {
        const msg = String(rpcError.message || rpcError.details || '').toLowerCase();
        // Backward compatibility: older DBs may not have activity feed RPC yet.
        if (msg.includes('not found') || msg.includes('does not exist')) {
          const legacy = await supabase.rpc('get_kill_feed_v1', {
            p_site_id: siteId,
            p_hours_back: 72,
            p_limit: 50,
          });
          if (legacy.error) {
            logger.warn('fetchKillFeed legacy RPC error', { error: legacy.error });
            return;
          }
          const legacyRows = Array.isArray(legacy.data) ? (legacy.data as any[]) : [];
          const feed = legacyRows
            .map((r: any) => ({
              id: String(r.id ?? '') + '-legacy',
              call_id: String(r.id ?? ''),
              at: String(r.action_at || r.created_at || ''),
              action_type: 'legacy',
              actor_type: 'system',
              previous_status: null,
              new_status: (r.status ?? null) as string | null,
              intent_action: (r.intent_action ?? null) as string | null,
              identity: (r.intent_target ?? null) as string | null,
              sale_amount:
                typeof r.sale_amount === 'number'
                  ? r.sale_amount
                  : r.sale_amount != null && r.sale_amount !== ''
                    ? Number(r.sale_amount)
                    : null,
              currency: (r.currency ?? null) as string | null,
              is_latest_for_call: true,
            }))
            .filter((x: any) => x.id && x.call_id && x.at);
          setHistory(feed);
          return;
        }

        logger.warn('fetchKillFeed RPC error', { error: rpcError });
        return;
      }
      if (!data) return;

      // Parse jsonb array
      let rows: any[] = [];
      if (Array.isArray(data)) rows = data as any[];
      else if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data) as unknown;
          rows = Array.isArray(parsed) ? (parsed as any[]) : [];
        } catch {
          rows = [];
        }
      }

      const feed = rows
        .map((r: any) => {
          const saleAmount =
            typeof r.sale_amount === 'number'
              ? r.sale_amount
              : r.sale_amount != null && r.sale_amount !== ''
                ? Number(r.sale_amount)
                : null;
          return {
            id: String(r.id ?? ''),
            call_id: String(r.call_id ?? ''),
            at: String(r.created_at ?? r.action_at ?? ''),
            action_type: String(r.action_type ?? ''),
            actor_type: String(r.actor_type ?? ''),
            previous_status: (r.previous_status ?? null) as string | null,
            new_status: (r.new_status ?? null) as string | null,
            intent_action: (r.intent_action ?? null) as string | null,
            identity: (r.intent_target ?? null) as string | null,
            sale_amount: Number.isFinite(saleAmount as any) ? (saleAmount as number) : null,
            currency: (r.currency ?? null) as string | null,
            is_latest_for_call: Boolean(r.is_latest_for_call),
          } satisfies ActivityRow;
        })
        .filter((x: any) => x.id && x.call_id && x.at);
      setHistory(feed);
    } catch (err) {
      logger.warn('fetchKillFeed error', { error: String((err as Error)?.message ?? err) });
    }
  }, [siteId]);

  const fetchUnscoredIntents = useCallback(async () => {
    if (!range) return;
    // Capture to satisfy TS narrowing inside nested helpers.
    const r = range;
    try {
      setLoading(true);
      setError(null);

      const supabase = createClient();

      async function fetchRange(): Promise<HunterIntentLite[]> {
        let data: unknown = null;
        // 1) Lite RPC (default limit 100) — cheap list payload
        const lite = await supabase.rpc('get_recent_intents_lite_v1', {
          p_site_id: siteId,
          p_date_from: r.fromIso,
          p_date_to: r.toIso,
          p_limit: 100,
          p_ads_only: false,
        });
        data = lite.data;
        const liteErr = lite.error;

        if (process.env.NODE_ENV === 'development') {
          const count = Array.isArray(data) ? data.length : 0;
          logger.info('Queue RPC get_recent_intents_lite_v1', {
            siteId,
            p_date_from: r.fromIso,
            p_date_to: r.toIso,
            rowCount: count,
            error: liteErr?.message ?? null,
          });
        }

        // Fallback: if lite RPC doesn't exist in older DBs
        const liteMsg = String(liteErr?.message || liteErr?.details || '').toLowerCase();
        if (liteErr && (liteMsg.includes('not found') || liteMsg.includes('does not exist'))) {
          // v1 uses since + minutes; derive minutes from range so Today/Yesterday both respect absolute range
          const fromMs = new Date(r.fromIso).getTime();
          const toMs = new Date(r.toIso).getTime();
          const minutesLookback = Math.max(1, Math.round((toMs - fromMs) / (60 * 1000)));
          const v1 = await supabase.rpc('get_recent_intents_v1', {
            p_site_id: siteId,
            p_since: r.fromIso,
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
        const fromMs = new Date(r.fromIso).getTime();
        const toMs = new Date(r.toIso).getTime();

        const filtered = rows.filter((r) => {
          const ts = new Date(r.created_at || 0).getTime();
          if (!Number.isFinite(ts)) return false;
          // Status filter: pending only
          const s = (r.status || '').toLowerCase();
          const isPending = !s || s === 'intent';
          return isPending && ts >= fromMs && ts < toMs;
        });
        if (process.env.NODE_ENV === 'development' && (rows.length > 0 || (Array.isArray(data) && (data as unknown[]).length > 0))) {
          logger.info('Queue filter', { parsed: rows.length, afterRangeFilter: filtered.length, fromIso: r.fromIso, toIso: r.toIso });
        }
        return filtered;
      }

      const rows = await fetchRange();
      setIntents(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load intents');
    } finally {
      setLoading(false);
    }
  }, [range, siteId]);

  // Lazy-load full details for the ACTIVE (top) card only
  useEffect(() => {
    if (!top?.id) return;
    void fetchIntentDetails(top.id);
  }, [fetchIntentDetails, top?.id]);

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

  // Initial fetch (when range becomes available)
  useEffect(() => {
    if (!range) return;
    fetchUnscoredIntents();
    fetchKillFeed();
  }, [fetchUnscoredIntents, fetchKillFeed, range]);

  // Realtime updates: refetch when new intents arrive
  useRealtimeDashboard(
    siteId,
    {
      onCallCreated: () => {
        void fetchUnscoredIntents();
        void fetchKillFeed();
      },
      onCallUpdated: () => {
        void fetchUnscoredIntents();
        void fetchKillFeed();
      },
    },
    // Holistic View: always ALL traffic
    { adsOnly: false }
  );

  const handleQualified = useCallback(() => {
    // Intent was qualified, refresh the list
    void fetchUnscoredIntents();
    void fetchKillFeed();
  }, [fetchUnscoredIntents, fetchKillFeed]);

  // Modal qualification hook (must be after handleQualified definition)
  const { qualify: qualifyModalIntent } = useIntentQualification(
    siteId,
    intentForSeal?.id ?? '',
    intentForSeal?.matched_session_id ?? null,
    handleQualified // Pass refetch for undo success
  );

  const closeDrawer = useCallback(() => {
    setSelectedIntent(null);
  }, []);

  const openDrawerWithLazyDetails = useCallback(
    async (callId: string) => {
      const full = await fetchIntentDetails(callId);
      if (!full) return;
      setSelectedIntent(full);
    },
    [fetchIntentDetails]
  );

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
    (_row: { id: string; status: 'confirmed' | 'junk'; intent_action: string | null; identity: string | null }) => {
      // History is DB-backed now; refresh instead of optimistic local rows.
      void fetchKillFeed();
    },
    [fetchKillFeed]
  );

  const undoLastAction = useCallback(
    async (callId: string) => {
      setRestoringIds((prev) => new Set(prev).add(callId));
      try {
        const supabase = createClient();
        const { error: rpcError } = await supabase.rpc('undo_last_action_v1', {
          p_call_id: callId,
          p_actor_type: 'user',
          p_actor_id: null,
          p_metadata: { ui: 'QualificationQueue', site_id: siteId },
        });
        if (rpcError) throw rpcError;
        pushToast('success', 'Undone.');
        // Refresh both queue and activity feed
        void fetchUnscoredIntents();
        void fetchKillFeed();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to undo';
        pushToast('danger', msg);
      } finally {
        setRestoringIds((prev) => {
          const next = new Set(prev);
          next.delete(callId);
          return next;
        });
      }
    },
    [fetchKillFeed, fetchUnscoredIntents, pushToast, siteId]
  );

  const cancelDeal = useCallback(
    async (callId: string) => {
      setRestoringIds((prev) => new Set(prev).add(callId));
      try {
        const res = await fetch(`/api/intents/${callId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cancelled', lead_score: 0 }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error || res.statusText);
        }
        pushToast('success', 'Deal cancelled.');
        // Refresh kill feed to show updated status
        void fetchKillFeed();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to cancel';
        pushToast('danger', msg);
      } finally {
        setRestoringIds((prev) => {
          const next = new Set(prev);
          next.delete(callId);
          return next;
        });
      }
    },
    [fetchKillFeed, pushToast]
  );

  const openSealModal = useCallback((intent: HunterIntent) => {
    setIntentForSeal(intent);
    setSealModalOpen(true);
  }, []);

  const clearSealIntent = useCallback(() => {
    setIntentForSeal(null);
  }, []);

  const onSealConfirm = useCallback(
    async (saleAmount: number | null, currency: string, leadScore: number) => {
      if (!intentForSeal) return;
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
    },
    [intentForSeal]
  );

  const onSealJunk = useCallback(async () => {
    const result = await qualifyModalIntent({ score: 0, status: 'junk' });
    if (!result.success) throw new Error(result.error);
  }, [qualifyModalIntent]);

  const onSealSuccess = useCallback(() => {
    if (!intentForSeal) return;
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
  }, [handleQualified, intentForSeal, optimisticRemove, pushHistoryRow, pushToast]);

  const onSealJunkSuccess = useCallback(() => {
    if (!intentForSeal) return;
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
  }, [handleQualified, intentForSeal, optimisticRemove, pushHistoryRow, pushToast]);

  const onSealError = useCallback(
    (message: string) => {
      pushToast('danger', message);
    },
    [pushToast]
  );

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

  const state: QueueControllerState = {
    range,
    bountyChips,
    siteCurrency,
    intents,
    loading,
    error,
    selectedIntent,
    detailsById,
    sealModalOpen,
    intentForSeal,
    sessionEvidence,
    history,
    restoringIds,
    toast,
    top,
    next,
    mergedTop,
    mergedNext,
  };

  const actions: QueueControllerActions = {
    setRange: (r) => setRangeState(r),
    fetchUnscoredIntents: () => void fetchUnscoredIntents(),
    fetchKillFeed: () => void fetchKillFeed(),
    handleQualified,
    openDrawerWithLazyDetails: (callId) => void openDrawerWithLazyDetails(callId),
    closeDrawer,
    rotateSkip,
    optimisticRemove,
    pushToast,
    pushHistoryRow,
    undoLastAction: (callId) => void undoLastAction(callId),
    cancelDeal: (callId) => void cancelDeal(callId),
    openSealModal,
    setSealModalOpen,
    clearSealIntent,
    onSealConfirm,
    onSealJunk,
    onSealSuccess,
    onSealJunkSuccess,
    onSealError,
  };

  return { state, actions };
}

