'use client';

import { useCallback, useEffect, useRef } from 'react';
import { mutate } from 'swr';
import { createClient } from '@/lib/supabase/client';
import { useRegisterSiteRealtimeQueueRefetch } from '@/lib/contexts/site-realtime-dashboard-context';
import { useIntentQualification } from '@/lib/hooks/use-intent-qualification';
import { useSiteConfig } from '@/lib/hooks/use-site-config';
import { useQueueUiState } from '@/lib/hooks/queue/use-queue-ui-state';
import { useQueueCommandDispatcher } from '@/lib/hooks/queue/use-queue-command-dispatcher';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { HunterIntent, HunterIntentLite } from '@/lib/types/hunter';
import { parseHunterIntentsFull, parseHunterIntentsLite } from '@/components/dashboard/qualification-queue/parsers';
import type { ActivityRow } from '@/components/dashboard/qualification-queue/activity-log-inline';
import { logger } from '@/lib/logging/logger';

export type QueueRange = { day: 'today' | 'yesterday'; fromIso: string; toIso: string };

export type QueueToastState = null | { kind: 'success' | 'danger'; text: string };

function parseRpcTimestampMs(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const raw = String(value).trim();
  if (!raw) return Number.NaN;

  // Postgres RPC may return "YYYY-MM-DD HH:mm:ss.ssssss+00".
  // Normalize to ISO8601 for consistent browser parsing.
  const normalized = raw
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')
    .replace('Z+00:00', '+00:00');

  const parsed = new Date(normalized).getTime();
  if (Number.isFinite(parsed)) return parsed;
  return new Date(raw).getTime();
}

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

  onSealConfirm: (
    saleAmount: number | null,
    currency: string,
    leadScore: number,
    callerPhone?: string
  ) => Promise<void>;
  onSealJunk: () => Promise<void>;
  onSealSuccess: () => void;
  onSealJunkSuccess: () => void;
  onSealError: (message: string) => void;
};

export function useQueueController(siteId: string): { state: QueueControllerState; actions: QueueControllerActions } {
  const { t } = useTranslation();
  const { bountyChips, currency: siteCurrency } = useSiteConfig(siteId);
  const { buildSealBody } = useQueueCommandDispatcher();
  const {
    range,
    setRangeState,
    intents,
    setIntents,
    loading,
    setLoading,
    error,
    setError,
    selectedIntent,
    setSelectedIntent,
    detailsById,
    setDetailsById,
    sealModalOpen,
    setSealModalOpen,
    intentForSeal,
    setIntentForSeal,
    sessionEvidence,
    setSessionEvidence,
    history,
    setHistory,
    restoringIds,
    setRestoringIds,
    toast,
    setToast,
  } = useQueueUiState();

  /** Avoid self-triggering effects when maps grow (Panoptic Phase 4 — stable callbacks). */
  const detailsByIdRef = useRef(detailsById);
  detailsByIdRef.current = detailsById;
  const sessionEvidenceRef = useRef(sessionEvidence);
  sessionEvidenceRef.current = sessionEvidence;

  // Holistic View: always ALL traffic (kept for parity even if unused directly)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const effectiveAdsOnly = false;

  const top = intents[0] || null;
  const next = intents[1] || null;

  const fetchIntentDetails = useCallback(
    async (callId: string): Promise<HunterIntent | null> => {
      if (!callId) return null;
      const cached = detailsByIdRef.current[callId];
      if (cached) return cached;
      try {
        const response = await fetch(
          `/api/intents/${encodeURIComponent(callId)}/details?siteId=${encodeURIComponent(siteId)}`,
          {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }
        );
        if (!response.ok) return null;
        const payload = (await response.json()) as { data?: unknown };
        const data = payload.data ?? null;
        // get_intent_details_v1 returns a single jsonb object
        const rows = parseHunterIntentsFull(data ? [data] : []);
        const full = rows[0] || null;
        if (!full) return null;
        setDetailsById((prev) => ({ ...prev, [callId]: full }));
        return full;
      } catch {
        // ignore
      }
      return null;
    },
    [siteId]
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
          type LegacyKillRow = Record<string, unknown> & { id?: unknown; action_at?: unknown; created_at?: unknown; status?: unknown; intent_action?: unknown; intent_target?: unknown; sale_amount?: unknown; currency?: unknown };
          const legacyRows: LegacyKillRow[] = Array.isArray(legacy.data) ? (legacy.data as LegacyKillRow[]) : [];
          const feed = legacyRows
            .map((r: LegacyKillRow) => ({
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
            .filter((x) => Boolean(x.id && x.call_id && x.at)) as ActivityRow[];
          setHistory(feed);
          return;
        }

        logger.warn('fetchKillFeed RPC error', { error: rpcError });
        return;
      }
      if (!data) return;

      type ActivityFeedRpcRow = Record<string, unknown> & { id?: unknown; call_id?: unknown; created_at?: unknown; action_at?: unknown; action_type?: unknown; actor_type?: unknown; previous_status?: unknown; new_status?: unknown; intent_action?: unknown; intent_target?: unknown; sale_amount?: unknown; currency?: unknown; is_latest_for_call?: unknown };
      let rows: ActivityFeedRpcRow[] = [];
      if (Array.isArray(data)) rows = data as ActivityFeedRpcRow[];
      else if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data) as unknown;
          rows = Array.isArray(parsed) ? (parsed as ActivityFeedRpcRow[]) : [];
        } catch {
          rows = [];
        }
      }

      const feed = rows
        .map((r: ActivityFeedRpcRow) => {
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
            sale_amount: typeof saleAmount === 'number' && Number.isFinite(saleAmount) ? saleAmount : null,
            currency: (r.currency ?? null) as string | null,
            is_latest_for_call: Boolean(r.is_latest_for_call),
          } satisfies ActivityRow;
        })
        .filter((x) => Boolean(x.id && x.call_id && x.at)) as ActivityRow[];
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

        // Fallback: some environments may still expose only the full v2 RPC during rollout.
        const liteMsg = String(liteErr?.message || liteErr?.details || '').toLowerCase();
        if (liteErr && (liteMsg.includes('not found') || liteMsg.includes('does not exist'))) {
          const v2 = await supabase.rpc('get_recent_intents_v2', {
            p_site_id: siteId,
            p_date_from: r.fromIso,
            p_date_to: r.toIso,
            p_limit: 100,
            p_ads_only: false,
          });
          data = v2.data;
          if (v2.error) {
            throw new Error('Queue visibility contract missing: get_recent_intents_lite_v1 is required');
          }
        } else if (liteErr) {
          throw liteErr;
        }

        // Parse to LITE list items, even when fallback returns the heavier v2 payload.
        const rows = parseHunterIntentsLite(data);
        // Range contract is half-open: [from, to) where to = next day start for "today" in TRT.
        const fromMs = new Date(r.fromIso).getTime();
        const toMs = new Date(r.toIso).getTime();

        const filtered = rows.filter((r) => {
          const ts = parseRpcTimestampMs(r.created_at);
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
      setError(err instanceof Error ? err.message : t('dashboard.commandCenter.queue.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [range, siteId, t]);

  // Preload full details for the active card and the next one so skip/rotate
  // keeps the full-size card ready instead of briefly falling back to the lite shell.
  useEffect(() => {
    const ids = [top?.id, next?.id].filter((value): value is string => Boolean(value));
    if (ids.length === 0) return;
    ids.forEach((id) => {
      void fetchIntentDetails(id);
    });
  }, [fetchIntentDetails, next?.id, top?.id]);

  // Keep evidence hot for the active and next card to avoid visual downgrades
  // when the deck advances.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const sessionIds = [top?.matched_session_id, next?.matched_session_id].filter((value): value is string => {
        if (!value) return false;
        return !sessionEvidenceRef.current[value];
      });
      if (sessionIds.length === 0) return;

      try {
        const supabase = createClient();
        await Promise.all(
          sessionIds.map(async (sid) => {
            const { data, error: rpcError } = await supabase.rpc('get_session_details', {
              p_site_id: siteId,
              p_session_id: sid,
            });
            if (rpcError || cancelled) return;
            const row = Array.isArray(data) ? data[0] : null;
            if (!row) return;
            setSessionEvidence((prev) => ({
              ...prev,
              [sid]: {
                city: row.city ?? null,
                district: row.district ?? null,
                device_type: row.device_type ?? null,
              },
            }));
          })
        );
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [next?.matched_session_id, siteId, top?.matched_session_id]);

  // Initial fetch (when range becomes available)
  useEffect(() => {
    if (!range) return;
    fetchUnscoredIntents();
    fetchKillFeed();
  }, [fetchUnscoredIntents, fetchKillFeed, range]);

  // Refetch policy: call-level realtime is owned by SiteRealtimeDashboardProvider (dashboard shell).
  useRegisterSiteRealtimeQueueRefetch(() => {
    void fetchUnscoredIntents();
    void fetchKillFeed();
  });

  const handleQualified = useCallback(() => {
    // Intent was qualified, refresh the list
    void fetchUnscoredIntents();
    void fetchKillFeed();
    // Revalidate P0 stats (revenue/kasa) so GELİR TAHMİNİ updates immediately
    mutate((key) => Array.isArray(key) && key[0] === 'get_command_center_p0_stats_v2');
  }, [fetchUnscoredIntents, fetchKillFeed]);

  // Modal qualification hook (must be after handleQualified definition)
  const { qualify: qualifyModalIntent } = useIntentQualification(
    siteId,
    intentForSeal?.id ?? '',
    intentForSeal?.matched_session_id ?? null,
    handleQualified, // Pass refetch for undo success
    intentForSeal?.version ?? null
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature required by caller, row unused (DB refresh)
    (_row: { id: string; status: 'confirmed' | 'junk'; intent_action: string | null; identity: string | null }) => {
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
        pushToast('success', t('toast.undone'));
        // Refresh both queue and activity feed
        void fetchUnscoredIntents();
        void fetchKillFeed();
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('toast.error.undoFailed');
        pushToast('danger', msg);
      } finally {
        setRestoringIds((prev) => {
          const next = new Set(prev);
          next.delete(callId);
          return next;
        });
      }
    },
    [fetchKillFeed, fetchUnscoredIntents, pushToast, siteId, t]
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
        pushToast('success', t('toast.dealCancelled'));
        // Refresh kill feed to show updated status
        void fetchKillFeed();
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('toast.error.failed');
        pushToast('danger', msg);
      } finally {
        setRestoringIds((prev) => {
          const next = new Set(prev);
          next.delete(callId);
          return next;
        });
      }
    },
    [fetchKillFeed, pushToast, t]
  );

  const openSealModal = useCallback((intent: HunterIntent) => {
    setIntentForSeal(intent);
    setSealModalOpen(true);
  }, []);

  const clearSealIntent = useCallback(() => {
    setIntentForSeal(null);
  }, []);

  const onSealConfirm = useCallback(
    async (
      saleAmount: number | null,
      currency: string,
      leadScore: number,
      callerPhone?: string
    ) => {
      if (!intentForSeal) return;
      const body = buildSealBody(intentForSeal, saleAmount, currency, leadScore, callerPhone);
      const res = await fetch(`/api/calls/${intentForSeal.id}/seal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || res.statusText);
      }
    },
    [buildSealBody, intentForSeal]
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
    pushToast('success', t('seal.dealSealed'));
    setSealModalOpen(false);
    setIntentForSeal(null);
    handleQualified();
  }, [handleQualified, intentForSeal, optimisticRemove, pushHistoryRow, pushToast, t]);

  const onSealJunkSuccess = useCallback(() => {
    if (!intentForSeal) return;
    optimisticRemove(intentForSeal.id);
    pushHistoryRow({
      id: intentForSeal.id,
      status: 'junk',
      intent_action: intentForSeal.intent_action ?? null,
      identity: intentForSeal.intent_target ?? null,
    });
    pushToast('success', t('seal.markedJunk'));
    setSealModalOpen(false);
    setIntentForSeal(null);
    handleQualified();
  }, [handleQualified, intentForSeal, optimisticRemove, pushHistoryRow, pushToast, t]);

  const onSealError = useCallback(
    (message: string) => {
      pushToast('danger', message);
    },
    [pushToast]
  );

  const mergedTop: HunterIntent | null = top
    ? (() => {
      const detail = detailsById[top.id];
      const sid = detail?.matched_session_id ?? top.matched_session_id ?? null;
      return {
        ...detail,
        id: detail?.id ?? top.id,
        created_at: detail?.created_at ?? top.created_at,
        intent_action: detail?.intent_action ?? top.intent_action ?? null,
        intent_target: detail?.intent_target ?? top.intent_target ?? top.summary ?? null,
        intent_page_url: detail?.intent_page_url ?? top.intent_page_url ?? null,
        page_url: detail?.page_url ?? top.page_url ?? top.intent_page_url ?? null,
        click_id: detail?.click_id ?? top.click_id ?? null,
        matched_session_id: sid,
        status: detail?.status ?? top.status ?? null,
        version: detail?.version ?? top.version ?? null,
        phone_clicks: detail?.phone_clicks ?? top.phone_clicks ?? null,
        whatsapp_clicks: detail?.whatsapp_clicks ?? top.whatsapp_clicks ?? null,
        traffic_source: detail?.traffic_source ?? top.traffic_source ?? null,
        traffic_medium: detail?.traffic_medium ?? top.traffic_medium ?? null,
        attribution_source: detail?.attribution_source ?? top.attribution_source ?? null,
        gclid: detail?.gclid ?? top.gclid ?? null,
        wbraid: detail?.wbraid ?? top.wbraid ?? null,
        gbraid: detail?.gbraid ?? top.gbraid ?? null,
        utm_term: detail?.utm_term ?? top.utm_term ?? null,
        utm_campaign: detail?.utm_campaign ?? top.utm_campaign ?? null,
        utm_source: detail?.utm_source ?? top.utm_source ?? null,
        matchtype: detail?.matchtype ?? top.matchtype ?? null,
        // Geo: prefer intent RPC (GCLID/geo_district hardened) over sessionEvidence; session.district often empty
        city: detail?.city ?? top.city ?? (sid ? sessionEvidence[sid]?.city : null) ?? null,
        district: detail?.district ?? top.district ?? (sid ? sessionEvidence[sid]?.district : null) ?? null,
        location_source: detail?.location_source ?? top.location_source ?? null,
        device_type: detail?.device_type ?? top.device_type ?? (sid ? sessionEvidence[sid]?.device_type : null) ?? null,
        device_os: detail?.device_os ?? top.device_os ?? null,
        total_duration_sec: detail?.total_duration_sec ?? top.total_duration_sec ?? null,
        event_count: detail?.event_count ?? top.event_count ?? null,
        estimated_value: detail?.estimated_value ?? top.estimated_value ?? null,
        currency: detail?.currency ?? top.currency ?? null,
        form_state: detail?.form_state ?? top.form_state ?? null,
        form_summary: detail?.form_summary ?? top.form_summary ?? null,
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

