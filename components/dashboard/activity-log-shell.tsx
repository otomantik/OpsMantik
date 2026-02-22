'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { buttonVariants, Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Home, RefreshCw, Undo2, Phone, MessageCircle, FileText, CircleDot } from 'lucide-react';

type ActivityRow = {
  id: string; // call_actions.id
  call_id: string;
  created_at: string;
  action_type: string;
  actor_type: string;
  actor_id: string | null;
  previous_status: string | null;
  new_status: string | null;
  intent_action: string | null;
  intent_target: string | null;
  lead_score: number | null;
  sale_amount: number | null;
  currency: string | null;
  reason: string | null;
  is_latest_for_call: boolean;
};

function iconForIntentAction(a: string | null) {
  const t = (a || '').toLowerCase();
  if (t === 'whatsapp') return MessageCircle;
  if (t === 'phone') return Phone;
  if (t === 'form') return FileText;
  return CircleDot;
}

function statusPill(status: string | null) {
  const s = (status || 'intent').toLowerCase();
  const base = 'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wider';
  if (s === 'confirmed' || s === 'qualified' || s === 'real') return <span className={cn(base, 'border-emerald-200 bg-emerald-50 text-emerald-800')}>{s}</span>;
  if (s === 'junk') return <span className={cn(base, 'border-red-200 bg-red-50 text-red-800')}>{s}</span>;
  if (s === 'cancelled') return <span className={cn(base, 'border-slate-200 bg-slate-50 text-slate-700')}>{s}</span>;
  return <span className={cn(base, 'border-slate-200 bg-white text-slate-700')}>{s}</span>;
}

export function ActivityLogShell({
  siteId,
  siteName,
}: {
  siteId: string;
  siteName?: string;
}) {
  const { t } = useTranslation();
  const [hoursBack, setHoursBack] = useState(72);
  const [onlyUndoable, setOnlyUndoable] = useState(false);
  const [actionType, setActionType] = useState<'all' | 'seal' | 'junk' | 'cancel' | 'restore' | 'undo'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [busyCallIds, setBusyCallIds] = useState<Set<string>>(new Set());

  const effectiveLimit = useMemo(() => 120, []);
  const effectiveActionTypes = useMemo(() => {
    if (actionType === 'all') return null;
    return [actionType];
  }, [actionType]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const res = await supabase.rpc('get_activity_feed_v1', {
        p_site_id: siteId,
        p_hours_back: hoursBack,
        p_limit: effectiveLimit,
        p_action_types: effectiveActionTypes,
      });

      if (res.error) {
        const msg = String(res.error.message || res.error.details || '').toLowerCase();
        if (msg.includes('not found') || msg.includes('does not exist')) {
          setError(t('dashboard.activityNotAvailable'));
          setRows([]);
          return;
        }
        throw res.error;
      }

      const data = res.data;
      type ActivityLogRpcRow = Record<string, unknown> & { id?: unknown; call_id?: unknown; created_at?: unknown; action_type?: unknown; actor_type?: unknown; actor_id?: unknown; previous_status?: unknown; new_status?: unknown; intent_action?: unknown; intent_target?: unknown; lead_score?: unknown; sale_amount?: unknown; currency?: unknown; reason?: unknown; is_latest_for_call?: unknown };
      const arr: ActivityLogRpcRow[] = Array.isArray(data) ? (data as ActivityLogRpcRow[]) : typeof data === 'string' ? (JSON.parse(data) as ActivityLogRpcRow[]) : [];
      const parsed: ActivityRow[] = (arr || [])
        .map((r: ActivityLogRpcRow) => ({
          id: String(r.id ?? ''),
          call_id: String(r.call_id ?? ''),
          created_at: String(r.created_at ?? ''),
          action_type: String(r.action_type ?? ''),
          actor_type: String(r.actor_type ?? ''),
          actor_id: (r.actor_id ?? null) as string | null,
          previous_status: (r.previous_status ?? null) as string | null,
          new_status: (r.new_status ?? null) as string | null,
          intent_action: (r.intent_action ?? null) as string | null,
          intent_target: (r.intent_target ?? null) as string | null,
          lead_score: typeof r.lead_score === 'number' ? r.lead_score : r.lead_score != null ? Number(r.lead_score) : null,
          sale_amount: typeof r.sale_amount === 'number' ? r.sale_amount : r.sale_amount != null ? Number(r.sale_amount) : null,
          currency: (r.currency ?? null) as string | null,
          reason: (r.reason ?? null) as string | null,
          is_latest_for_call: Boolean(r.is_latest_for_call),
        }))
        .filter((x) => x.id && x.call_id && x.created_at);
      setRows(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity log');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveActionTypes, effectiveLimit, hoursBack, siteId]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const undo = useCallback(
    async (callId: string) => {
      setBusyCallIds((prev) => new Set(prev).add(callId));
      try {
        const supabase = createClient();
        const { error: rpcError } = await supabase.rpc('undo_last_action_v1', {
          p_call_id: callId,
          p_actor_type: 'user',
          p_actor_id: null,
          p_metadata: { ui: 'ActivityLog', site_id: siteId },
        });
        if (rpcError) throw rpcError;
        await fetchRows();
      } finally {
        setBusyCallIds((prev) => {
          const next = new Set(prev);
          next.delete(callId);
          return next;
        });
      }
    },
    [fetchRows, siteId]
  );

  return (
    <div className="om-dashboard-reset min-h-screen overflow-x-hidden pb-10 bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 w-full min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/dashboard/site/${siteId}`}
                className={cn(
                  buttonVariants({ variant: 'ghost' }),
                  "-ml-2 h-10 px-3 inline-flex items-center gap-2 min-w-0 hover:bg-slate-100 transition-colors rounded-lg"
                )}
              >
                <Home className="h-5 w-5 shrink-0 text-slate-600" />
                <span className="text-base font-bold tracking-tight text-slate-800 truncate max-w-[280px] sm:max-w-none">
                  {siteName || 'OpsMantik'}
                </span>
              </Link>
              <div className="text-xs font-semibold uppercase tracking-wider px-3 pt-0.5 leading-none text-slate-500">
                {t('dashboard.activityLogKillFeed')}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Hours</span>
                <select
                  className="h-7 text-xs font-bold bg-transparent outline-none"
                  value={hoursBack}
                  onChange={(e) => setHoursBack(Number(e.target.value))}
                >
                  <option value={6}>6</option>
                  <option value={24}>24</option>
                  <option value={72}>72</option>
                  <option value={168}>168</option>
                </select>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Action</span>
                <select
                  className="h-7 text-xs font-bold bg-transparent outline-none"
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value as 'all' | 'seal' | 'junk' | 'cancel' | 'restore' | 'undo')}
                >
                  <option value="all">ALL</option>
                  <option value="seal">SEAL</option>
                  <option value="junk">JUNK</option>
                  <option value="cancel">CANCEL</option>
                  <option value="restore">RESTORE</option>
                  <option value="undo">UNDO</option>
                </select>
              </div>

              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 h-9">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={onlyUndoable}
                  onChange={(e) => setOnlyUndoable(e.target.checked)}
                />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Only undoable</span>
              </label>

              <Button
                variant="outline"
                className="h-9 px-3 text-xs font-bold uppercase tracking-wider border-slate-200 bg-white hover:bg-slate-50"
                onClick={() => fetchRows()}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xs font-black uppercase tracking-widest text-slate-600">Recent actions</div>
            <div className="text-xs text-slate-500 tabular-nums">{rows.length} rows</div>
          </div>

          {error && (
            <div className="px-4 py-3 text-sm border-b border-amber-200 bg-amber-50 text-amber-900">
              {error}
            </div>
          )}

          {loading ? (
            <div className="p-6 text-sm text-slate-600">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-slate-600">No actions in this window.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {rows
                .filter((r) => {
                  if (!onlyUndoable) return true;
                  return r.is_latest_for_call && r.action_type.toLowerCase() !== 'undo';
                })
                .map((r) => {
                const Icon = iconForIntentAction(r.intent_action);
                const canUndo = r.is_latest_for_call && r.action_type.toLowerCase() !== 'undo';
                const busy = busyCallIds.has(r.call_id);
                return (
                  <div
                    key={r.id}
                    className={cn(
                      'px-4 py-3 flex flex-col items-start gap-2',
                      'sm:flex-row sm:items-center sm:justify-between sm:gap-3',
                      busy && 'opacity-60'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 w-full">
                      {/* Keep time on desktop; on mobile it consumes too much horizontal space */}
                      <div className="hidden sm:block w-[76px] text-xs tabular-nums text-slate-500 shrink-0" suppressHydrationWarning>
                        {formatRelativeTime(r.created_at)}
                      </div>
                      <Icon className="h-4 w-4 text-slate-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold tabular-nums truncate">
                          {r.intent_target || '—'}
                        </div>
                        <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                          <span className="sm:hidden mr-2 normal-case font-semibold">
                            {formatRelativeTime(r.created_at)}
                          </span>
                          {r.action_type} • {r.actor_type}
                          {r.reason ? ` • ${r.reason}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-start sm:justify-end gap-2 w-full sm:w-auto">
                      {r.sale_amount != null && (
                        <span className="text-xs font-black tabular-nums text-slate-700">
                          {r.sale_amount} {r.currency || ''}
                        </span>
                      )}
                      {statusPill(r.new_status)}
                      {canUndo && (
                        <Button
                          variant="outline"
                          className="h-8 px-2.5 text-xs font-bold border-slate-200"
                          onClick={() => undo(r.call_id)}
                          disabled={busy}
                          aria-label="Undo last action"
                          title="Undo last action"
                        >
                          <Undo2 className="h-3.5 w-3.5 sm:mr-2" />
                          <span className="hidden sm:inline">Undo</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

