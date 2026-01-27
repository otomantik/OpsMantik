'use client';

/**
 * LazySessionDrawer (Phase A)
 * Opens immediately, then fetches:
 * - get_session_details(site_id, session_id)
 * - get_session_timeline(site_id, session_id, limit)
 *
 * No prefetch for list rows.
 */

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatTimestamp } from '@/lib/utils';
import type { LiveInboxIntent } from './live-inbox';

type SessionDetailsRow = {
  id: string;
  site_id: string;
  created_at: string;
  created_month: string;
  city: string | null;
  district: string | null;
  device_type: string | null;
  attribution_source: string | null;
  gclid: string | null;
  fingerprint: string | null;
};

type TimelineEvent = {
  id: string;
  created_at: string;
  event_category: string;
  event_action: string;
  event_label: string | null;
  url: string | null;
  metadata: any;
};

export function LazySessionDrawer({
  siteId,
  intent,
  onClose,
}: {
  siteId: string;
  intent: LiveInboxIntent;
  onClose: () => void;
}) {
  const sessionId = intent.matched_session_id;
  const [details, setDetails] = useState<SessionDetailsRow | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    if (intent.intent_action === 'phone') return 'Session (phone)';
    if (intent.intent_action === 'whatsapp') return 'Session (whatsapp)';
    return 'Session';
  }, [intent.intent_action]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      setDetails(null);
      setEvents([]);
      if (!sessionId) {
        setLoading(false);
        return;
      }
      try {
        const supabase = createClient();
        const [{ data: sData, error: sErr }, { data: tData, error: tErr }] = await Promise.all([
          supabase.rpc('get_session_details', { p_site_id: siteId, p_session_id: sessionId }),
          supabase.rpc('get_session_timeline', { p_site_id: siteId, p_session_id: sessionId, p_limit: 100 }),
        ]);
        if (cancelled) return;
        if (sErr) throw sErr;
        const row = Array.isArray(sData) ? sData[0] : null;
        setDetails(row || null);
        if (tErr) throw tErr;
        setEvents((tData as any[]) || []);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Failed to load session');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [sessionId, siteId]);

  return (
    <div className="fixed inset-0 z-50">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* sheet */}
      <div className="absolute right-0 top-0 h-full w-full sm:w-[620px] bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-sm font-mono text-slate-200 uppercase tracking-tighter">{title}</div>
            <div className="text-[10px] font-mono text-slate-500 mt-1">
              Intent: <span className="text-slate-400">{intent.id.slice(0, 8)}…</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[10px] font-mono text-slate-400 hover:text-slate-200 border border-slate-800/60 px-2 py-1 rounded"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="p-6 text-center text-[10px] font-mono text-slate-500 uppercase tracking-widest">
              Loading session…
            </div>
          ) : error ? (
            <div className="p-4 border border-rose-500/20 bg-rose-500/5 text-[10px] font-mono text-rose-300">
              {error}
            </div>
          ) : (
            <>
              <div className="p-3 rounded border border-slate-800 bg-slate-800/20">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">Created</div>
                    <div className="text-[11px] font-mono text-slate-200" suppressHydrationWarning>
                      {details?.created_at ? formatTimestamp(details.created_at, { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">Device</div>
                    <div className="text-[11px] font-mono text-slate-200">
                      {details?.device_type || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">City</div>
                    <div className="text-[11px] font-mono text-slate-200">
                      {details?.city || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">Attribution</div>
                    <div className="text-[11px] font-mono text-slate-200 truncate">
                      {details?.attribution_source || '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded border border-slate-800 bg-slate-800/10">
                <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-2">
                  Timeline ({events.length})
                </div>
                {events.length === 0 ? (
                  <div className="text-[10px] font-mono text-slate-600">No events</div>
                ) : (
                  <div className="space-y-2">
                    {events.slice(0, 100).map((e) => (
                      <div key={e.id} className="p-2 rounded border border-slate-800/60 bg-slate-900/30">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-mono text-slate-200 truncate">
                            {e.event_category}/{e.event_action}
                          </div>
                          <div className="text-[9px] font-mono text-slate-600" suppressHydrationWarning>
                            {formatTimestamp(e.created_at, { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        {(e.event_label || e.url) && (
                          <div className="text-[10px] font-mono text-slate-500 truncate mt-1">
                            {e.event_label || e.url}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {!sessionId && (
            <div className="p-4 border border-slate-800 bg-slate-800/10 text-[10px] font-mono text-slate-500">
              No matched session for this intent.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

