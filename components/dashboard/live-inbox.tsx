'use client';

/**
 * LiveInbox (Phase A)
 * - Initial fetch: get_recent_intents_v1 (last 60m)
 * - Realtime: calls INSERT/UPDATE scoped by site_id
 * - Poll merge: every 30s fetch since lastSeenCreatedAt
 *
 * Constraints:
 * - No heavy joins for list rows (uses calls + lightweight fields)
 * - Batch state updates to avoid rerender storms
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatTimestamp } from '@/lib/utils';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { LazySessionDrawer } from './lazy-session-drawer';

export type LiveInboxIntent = {
  id: string;
  created_at: string;
  intent_action: 'phone' | 'whatsapp' | string | null;
  intent_target: string | null;
  intent_stamp: string | null;
  intent_page_url: string | null;
  matched_session_id: string | null;
  lead_score: number | null;
  status: string | null;
  click_id: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
};

function parseRpcJsonbArray(data: unknown): LiveInboxIntent[] {
  // get_recent_intents_v1 returns jsonb[]; supabase-js usually maps it to an array of objects.
  if (!data) return [];
  if (Array.isArray(data)) {
    // Best case: data is json objects already
    if (data.length === 0) return [];
    if (typeof data[0] === 'object' && data[0] !== null && !Array.isArray(data[0])) {
      return data as LiveInboxIntent[];
    }
    // Sometimes Postgres arrays can come back as strings; attempt JSON parse per element
    if (typeof data[0] === 'string') {
      const out: LiveInboxIntent[] = [];
      for (const item of data as string[]) {
        try {
          const parsed = JSON.parse(item);
          if (parsed && typeof parsed === 'object') out.push(parsed as LiveInboxIntent);
        } catch {
          // ignore
        }
      }
      return out;
    }
  }
  // If supabase returns a single row containing the array (rare), try unwrap
  if (typeof data === 'object' && data !== null) {
    const anyData = data as any;
    if (Array.isArray(anyData[0])) return anyData[0] as LiveInboxIntent[];
  }
  return [];
}

function keyOf(i: LiveInboxIntent): string {
  return (i.intent_stamp && i.intent_stamp.length > 0) ? `s:${i.intent_stamp}` : `id:${i.id}`;
}

export function LiveInbox({ siteId }: { siteId: string }) {
  const [items, setItems] = useState<LiveInboxIntent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LiveInboxIntent | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const mountedRef = useRef(true);

  // batching: avoid rerender storms
  const pendingRef = useRef<Array<{ type: 'upsert'; item: LiveInboxIntent }>>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDebug = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('opsmantik_debug_inbox') === '1';
  }, []);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const ops = pendingRef.current.splice(0, pendingRef.current.length);
    if (ops.length === 0) return;

    setItems((prev) => {
      const map = new Map<string, LiveInboxIntent>();
      for (const it of prev) map.set(keyOf(it), it);

      let deduped = 0;
      for (const op of ops) {
        const k = keyOf(op.item);
        if (map.has(k)) deduped++;
        map.set(k, { ...map.get(k), ...op.item });
      }
      const merged = Array.from(map.values()).sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        if (tb !== ta) return tb - ta;
        return (b.id || '').localeCompare(a.id || '');
      });
      if (isDebug && deduped > 0) {
        // eslint-disable-next-line no-console
        console.log('[LiveInbox] dedupe', { deduped, ops: ops.length });
      }
      return merged.slice(0, 250);
    });
  }, [isDebug]);

  const enqueueUpsert = useCallback((item: LiveInboxIntent) => {
    pendingRef.current.push({ type: 'upsert', item });
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(flush, 200);
    }
  }, [flush]);

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc('get_recent_intents_v1', {
        p_site_id: siteId,
        p_since: null,
        p_minutes_lookback: 60,
        p_limit: 200,
        p_ads_only: true,
      });
      if (rpcError) throw rpcError;
      const rows = parseRpcJsonbArray(data);
      if (!mountedRef.current) return;
      setItems(rows);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || 'Failed to load inbox');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [siteId]);

  const lastSeenCreatedAt = useMemo(() => {
    if (items.length === 0) return null;
    return items.reduce<string | null>((max, it) => {
      if (!max) return it.created_at;
      return new Date(it.created_at) > new Date(max) ? it.created_at : max;
    }, null);
  }, [items]);

  const pollMerge = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc('get_recent_intents_v1', {
        p_site_id: siteId,
        p_since: lastSeenCreatedAt,
        p_minutes_lookback: 60,
        p_limit: 200,
        p_ads_only: true,
      });
      if (rpcError) throw rpcError;
      const rows = parseRpcJsonbArray(data);
      for (const r of rows) enqueueUpsert(r);
      if (isDebug) {
        // eslint-disable-next-line no-console
        console.log('[LiveInbox] poll merge', { since: lastSeenCreatedAt, got: rows.length });
      }
    } catch (e) {
      if (isDebug) {
        // eslint-disable-next-line no-console
        console.log('[LiveInbox] poll merge error', e);
      }
    }
  }, [enqueueUpsert, isDebug, lastSeenCreatedAt, siteId]);

  useEffect(() => {
    mountedRef.current = true;
    fetchInitial();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchInitial]);

  // Realtime subscribe: calls INSERT/UPDATE scoped by site_id
  useEffect(() => {
    const supabase = createClient();
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    const channel = supabase
      .channel(`calls-live-inbox-${siteId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'calls', filter: `site_id=eq.${siteId}` },
        (payload) => {
          const row = payload.new as any;
          if (row?.source !== 'click') return;
          enqueueUpsert({
            id: row.id,
            created_at: row.created_at,
            intent_action: row.intent_action,
            intent_target: row.intent_target,
            intent_stamp: row.intent_stamp,
            intent_page_url: row.intent_page_url,
            matched_session_id: row.matched_session_id,
            lead_score: row.lead_score,
            status: row.status,
            click_id: row.click_id,
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calls', filter: `site_id=eq.${siteId}` },
        (payload) => {
          const row = payload.new as any;
          if (row?.source !== 'click') return;
          enqueueUpsert({
            id: row.id,
            created_at: row.created_at,
            intent_action: row.intent_action,
            intent_target: row.intent_target,
            intent_stamp: row.intent_stamp,
            intent_page_url: row.intent_page_url,
            matched_session_id: row.matched_session_id,
            lead_score: row.lead_score,
            status: row.status,
            click_id: row.click_id,
          });
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [enqueueUpsert, siteId]);

  // Poll merge (30s): backfill missed realtime events
  useEffect(() => {
    const t = setInterval(() => {
      pollMerge();
    }, 30_000);
    return () => clearInterval(t);
  }, [pollMerge]);

  const rows = items.slice(0, 200);

  return (
    <>
      <Card className="glass border-slate-800/50">
        <CardHeader className="pb-3 border-b border-slate-800/20">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-mono text-slate-200 uppercase tracking-tighter">
                Live Inbox
              </CardTitle>
              <p className="text-[10px] font-mono text-slate-500 mt-1 uppercase tracking-wider">
                Last 60 minutes • {rows.length} items
              </p>
            </div>
            <button
              onClick={fetchInitial}
              className="text-[10px] font-mono text-slate-400 hover:text-slate-200 border border-slate-800/60 px-2 py-1 rounded"
            >
              Refresh
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="px-4 py-2 border-b border-rose-500/20 bg-rose-500/5">
              <div className="text-[10px] text-rose-400 font-mono">
                Error: {error}
              </div>
            </div>
          )}
          {loading ? (
            <div className="p-8 text-center text-[10px] font-mono text-slate-500 uppercase tracking-widest">
              Loading inbox...
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-[10px] font-mono text-slate-600 uppercase tracking-widest">
              No recent intents
            </div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-slate-900/50 border-b border-slate-800/30 sticky top-0">
                  <tr>
                    <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Time</th>
                    <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Type</th>
                    <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Target</th>
                    <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Page</th>
                    <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Score</th>
                    <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/30">
                  {rows.map((it) => (
                    <tr
                      key={keyOf(it)}
                      className="hover:bg-slate-800/20 cursor-pointer transition-colors"
                      onClick={() => setSelected(it)}
                    >
                      <td className="p-3">
                        <div className="text-[11px] font-mono text-slate-200" suppressHydrationWarning>
                          {formatTimestamp(it.created_at, { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="text-[9px] font-mono text-slate-600" suppressHydrationWarning>
                          {formatTimestamp(it.created_at, { day: '2-digit', month: 'short' })}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded border border-slate-700/50 bg-slate-800/30 text-[10px] font-mono text-slate-200 uppercase">
                          {it.intent_action || 'unknown'}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="text-[11px] font-mono text-slate-300 truncate max-w-[240px]">
                          {it.intent_target || '—'}
                        </div>
                        <div className="text-[9px] font-mono text-slate-600 truncate max-w-[240px]">
                          {it.click_id || it.gclid || it.wbraid || it.gbraid || ''}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="text-[11px] font-mono text-slate-300 truncate max-w-[360px]">
                          {it.intent_page_url ? (() => {
                            try { return new URL(it.intent_page_url).pathname; } catch { return it.intent_page_url; }
                          })() : '—'}
                        </div>
                        <div className="text-[9px] font-mono text-slate-600 truncate max-w-[360px]">
                          {it.intent_page_url || ''}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="text-[11px] font-mono text-slate-200">
                          {typeof it.lead_score === 'number' ? it.lead_score : '—'}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="text-[10px] font-mono text-slate-400 uppercase">
                          {it.status ?? 'pending'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <LazySessionDrawer
          siteId={siteId}
          intent={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

