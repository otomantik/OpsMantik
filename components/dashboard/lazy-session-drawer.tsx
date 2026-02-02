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
import type { LiveInboxIntent } from '@/lib/types/dashboard';

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
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load session');
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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* sheet */}
      <div className="absolute right-0 top-0 h-full w-full sm:w-[620px] bg-background border-l border-border shadow-2xl flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">{title}</div>
            <div className="text-sm text-muted-foreground mt-1 tabular-nums">
              Intent: <span className="text-foreground">{intent.id.slice(0, 8)}…</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground border border-border px-3 py-2 rounded"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading session…</div>
          ) : error ? (
            <div className="p-4 border border-rose-200 bg-rose-50 text-sm text-rose-900">{error}</div>
          ) : (
            <>
              <div className="p-4 rounded border border-border bg-muted">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground uppercase tracking-wider">Created</div>
                    <div className="text-sm text-foreground tabular-nums" suppressHydrationWarning>
                      {details?.created_at ? formatTimestamp(details.created_at, { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground uppercase tracking-wider">Device</div>
                    <div className="text-sm text-foreground">
                      {details?.device_type || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground uppercase tracking-wider">City</div>
                    <div className="text-sm text-foreground">
                      {details?.city || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground uppercase tracking-wider">Attribution</div>
                    <div className="text-sm text-foreground truncate">
                      {details?.attribution_source || '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded border border-border bg-background">
                <div className="text-sm text-muted-foreground uppercase tracking-wider mb-2">
                  Timeline ({events.length})
                </div>
                {events.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No events</div>
                ) : (
                  <div className="space-y-2">
                    {events.slice(0, 100).map((e) => (
                      <div key={e.id} className="p-3 rounded border border-border bg-muted/50">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm text-foreground truncate">
                            {e.event_category}/{e.event_action}
                          </div>
                          <div className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
                            {formatTimestamp(e.created_at, { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        {(e.event_label || e.url) && (
                          <div className="text-sm text-muted-foreground truncate mt-1">
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
            <div className="p-4 border border-border bg-muted text-sm text-muted-foreground">
              No matched session for this intent.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

