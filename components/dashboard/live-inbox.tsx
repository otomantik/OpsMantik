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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { formatTimestamp } from '@/lib/utils';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { LazySessionDrawer } from './lazy-session-drawer';
import { Copy } from 'lucide-react';

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

function shortId(s: string | null | undefined, take = 8): string {
  if (!s) return '—';
  if (s.length <= take) return s;
  return `${s.slice(0, take)}…`;
}

function maskTarget(s: string | null | undefined): string {
  if (!s) return '—';
  const digits = s.replace(/[^\d+]/g, '');
  // phone-like: +905xxxxxxxxx
  if (digits.length >= 8) {
    const head = digits.slice(0, 3);
    const tail = digits.slice(-2);
    return `${head}…${tail}`;
  }
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}

async function copyToClipboard(text: string) {
  if (typeof navigator === 'undefined') return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

function statusBadgeVariant(status: string | null): { label: string; variant: 'secondary' | 'muted' | 'destructive' } {
  const s = (status || 'intent').toLowerCase();
  if (s === 'junk' || s === 'suspicious') return { label: 'Junk', variant: 'destructive' };
  if (s === 'confirmed' || s === 'qualified' || s === 'real') return { label: 'Sealed', variant: 'secondary' };
  return { label: 'Pending', variant: 'muted' };
}

function typeBadgeVariant(action: string | null): { label: string; variant: 'secondary' | 'muted' } {
  const a = (action || '').toLowerCase();
  if (a === 'phone') return { label: 'Phone', variant: 'secondary' };
  if (a === 'whatsapp') return { label: 'WhatsApp', variant: 'secondary' };
  if (a === 'form') return { label: 'Form', variant: 'secondary' };
  return { label: action || 'Unknown', variant: 'muted' };
}

export function LiveInbox({ siteId }: { siteId: string }) {
  const [items, setItems] = useState<LiveInboxIntent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LiveInboxIntent | null>(null);
  const [isMounted, setIsMounted] = useState(false);

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
    setIsMounted(true);
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
      <TooltipProvider>
      <Card className="bg-background text-foreground border border-border">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-mono uppercase tracking-tight">
                Intent Inbox
              </CardTitle>
              <div className="text-sm text-muted-foreground mt-1">
                Last 60 minutes{isMounted ? ` • ${rows.length} rows` : ''}
              </div>
            </div>
            <Button variant="outline" onClick={fetchInitial}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="px-4 py-3 border-b border-border bg-muted">
              <div className="text-sm text-foreground">
                Error: {error}
              </div>
            </div>
          )}
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No recent intents.</div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="text-sm">Time (TRT)</TableHead>
                    <TableHead className="text-sm">Type</TableHead>
                    <TableHead className="text-sm">Target</TableHead>
                    <TableHead className="text-sm">Page</TableHead>
                    <TableHead className="text-sm">Click ID</TableHead>
                    <TableHead className="text-sm">Stamp</TableHead>
                    <TableHead className="text-sm">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((it) => {
                    const t = typeBadgeVariant(it.intent_action);
                    const s = statusBadgeVariant(it.status);
                    const clickIds = [
                      it.gclid ? { k: 'GCLID', v: it.gclid } : null,
                      it.wbraid ? { k: 'WBRAID', v: it.wbraid } : null,
                      it.gbraid ? { k: 'GBRAID', v: it.gbraid } : null,
                    ].filter(Boolean) as Array<{ k: string; v: string }>;
                    const pagePath = it.intent_page_url
                      ? (() => {
                          try {
                            return new URL(it.intent_page_url).pathname || '/';
                          } catch {
                            return it.intent_page_url;
                          }
                        })()
                      : '—';

                    return (
                      <TableRow
                        key={keyOf(it)}
                        className="cursor-pointer"
                        onClick={() => setSelected(it)}
                      >
                        <TableCell className="text-sm tabular-nums font-mono" suppressHydrationWarning>
                          {typeof window !== 'undefined'
                            ? formatTimestamp(it.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                            : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          <Badge variant={t.variant}>{t.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          <div className="flex items-center gap-2">
                            <span className="tabular-nums">{maskTarget(it.intent_target)}</span>
                            {it.intent_target && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  copyToClipboard(it.intent_target || '');
                                }}
                                title="Copy target"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {it.intent_page_url ? (
                            <Tooltip>
                              <TooltipTrigger>
                                <span className="block max-w-[360px] truncate">{pagePath}</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="font-mono text-sm">{it.intent_page_url}</div>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          <div className="flex flex-wrap gap-1">
                            {clickIds.length === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              clickIds.map((c) => (
                                <Badge key={c.k} variant="outline" className="tabular-nums">
                                  {c.k}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-mono tabular-nums">
                          <div className="flex items-center gap-2">
                            <span>{shortId(it.intent_stamp, 10)}</span>
                            {it.intent_stamp && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  copyToClipboard(it.intent_stamp || '');
                                }}
                                title="Copy stamp"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <Badge variant={s.variant}>{s.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </TooltipProvider>

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

