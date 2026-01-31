/**
 * Session Drawer - Shows detailed session information for an intent
 */

'use client';

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { IntentRow } from '@/lib/hooks/use-intents';
import { formatTimestamp } from '@/lib/utils';
import { SessionGroup } from './session-group';

/**
 * TEMP DEBUG (gated, 1 run only)
 * Enable by running in browser console:
 *   localStorage.setItem('opsmantik_debug_sessions_errors_once', '1'); location.reload();
 * Logs will self-disable after the first page load that consumes the flag.
 */
function shouldLogSessionsErrorsThisRun(): boolean {
  if (typeof window === 'undefined') return false;
  const key = 'opsmantik_debug_sessions_errors_once';
  const anyWindow = window as any;
  if (anyWindow.__opsmantikDebugSessionsErrorsThisRun === true) return true;
  const enabled = window.localStorage.getItem(key) === '1';
  if (!enabled) return false;
  window.localStorage.removeItem(key);
  anyWindow.__opsmantikDebugSessionsErrorsThisRun = true;
  return true;
}

interface SessionDrawerProps {
  intent: IntentRow;
  siteId: string;
  onClose: () => void;
  onStatusChange?: (status: string) => Promise<void>;
}

interface SessionData {
  id: string;
  created_at: string;
  city: string | null;
  district: string | null;
  device_type: string | null;
  fingerprint: string | null;
  created_month: string;
  events: Array<{
    id: string;
    event_category: string;
    event_action: string;
    event_label: string | null;
    event_value: number | null;
    metadata: any;
    created_at: string;
    url?: string;
  }>;
}

export function SessionDrawer({ intent, siteId, onClose, onStatusChange }: SessionDrawerProps) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLimitedView, setIsLimitedView] = useState(false);
  const [limitedReason, setLimitedReason] = useState<string | null>(null);

  useEffect(() => {
    if (!intent.matched_session_id) {
      setIsLoading(false);
      return;
    }

    const fetchSession = async () => {
      setIsLoading(true);
      setError(null);
      setIsLimitedView(false);
      setLimitedReason(null);

      try {
        const supabase = createClient();

        // Fetch session
        const { data: sessionData, error: sessionError } = await supabase.rpc('get_session_details', {
          p_site_id: siteId,
          p_session_id: intent.matched_session_id,
        });

        // Graceful limited view: session might be missing, denied, or not authenticated.
        // Do NOT surface as a red error unless it's unexpected.
        if (sessionError) {
          const msg = (sessionError as any)?.message;
          const details = (sessionError as any)?.details;
          const expected = msg === 'access_denied' || msg === 'not_authenticated';
          setSession(null);
          setIsLimitedView(true);
          setLimitedReason(expected ? msg : (details || msg || 'unavailable'));
          return;
        }
        if (!sessionData || !Array.isArray(sessionData) || sessionData.length === 0) {
          setSession(null);
          setIsLimitedView(true);
          setLimitedReason('unavailable');
          return;
        }
        const sessionRow = sessionData[0];

        // Fetch events
        const { data: eventsData, error: eventsError } = await supabase
          .from('events')
          .select('id, event_category, event_action, event_label, event_value, metadata, created_at, url, session_month')
          .eq('session_id', intent.matched_session_id)
          .eq('session_month', sessionRow.created_month)
          .order('created_at', { ascending: true });

        if (eventsError) throw eventsError;

        setSession({
          id: sessionRow.id,
          created_at: sessionRow.created_at,
          city: sessionRow.city,
          district: sessionRow.district,
          device_type: sessionRow.device_type,
          fingerprint: sessionRow.fingerprint,
          created_month: sessionRow.created_month,
          events: eventsData || [],
        });
      } catch (err: unknown) {
        if (shouldLogSessionsErrorsThisRun()) {
          const e = err as any;
          const payload = {
            code: e?.code,
            message: e?.message,
            details: e?.details,
            hint: e?.hint,
            status: e?.status,
            name: e?.name,
          };
          console.log('[DEBUG][sessions][SessionDrawer] failing query context', {
            table: 'sessions',
            select: 'id, created_at, city, district, device_type, ip, user_agent, fingerprint, created_month',
            filters: { id: intent.matched_session_id, site_id: siteId },
            method: 'single()',
          });
          console.log('[DEBUG][sessions][SessionDrawer] error payload', payload);
          try {
            console.log('[DEBUG][sessions][SessionDrawer] error JSON', JSON.stringify(e));
          } catch {
            // ignore
          }
        }
        // Avoid red console spam; show limited view for unknown failures too.
        // Still keep a human-readable UI state.
        setSession(null);
        setIsLimitedView(true);
        setLimitedReason('unavailable');
        if (shouldLogSessionsErrorsThisRun()) {
          console.log('[DEBUG][sessions][SessionDrawer] unexpected error', err);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();
  }, [intent.matched_session_id, siteId]);

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="relative w-full sm:w-[600px] sm:max-w-full h-[90vh] sm:h-auto sm:max-h-[90vh] bg-background text-foreground border-t sm:border border-border rounded-t-lg sm:rounded-lg shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-base font-semibold tracking-tight">
            Session Details
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
            </div>
          ) : isLimitedView ? (
            <div className="py-8">
              <div className="mb-4 p-3 rounded border border-border bg-muted">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground uppercase tracking-widest">
                      Limited view
                    </p>
                    <p className="text-sm text-foreground mt-1">
                      Session details unavailable (permission/expired/missing).
                    </p>
                  </div>
                  <div className="text-sm text-muted-foreground text-right tabular-nums">
                    Site scope: <span className="text-muted-foreground">{siteId.slice(0, 8)}…</span>
                  </div>
                </div>
                {limitedReason && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Reason: <span className="text-muted-foreground">{limitedReason}</span>
                  </p>
                )}
              </div>

              {/* Keep UX: show intent-level info even if session fetch fails */}
              <div className="space-y-2">
                <div className="p-3 rounded bg-muted border border-border">
                  <p className="text-sm text-muted-foreground uppercase tracking-wider">Intent</p>
                  <div className="mt-1 text-sm break-all tabular-nums">
                    {intent.id}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded bg-muted border border-border">
                    <p className="text-sm text-muted-foreground uppercase tracking-wider">Type</p>
                    <p className="mt-1 text-sm">{intent.type}</p>
                  </div>
                  <div className="p-3 rounded bg-muted border border-border">
                    <p className="text-sm text-muted-foreground uppercase tracking-wider">Time</p>
                    <p className="mt-1 text-sm tabular-nums" suppressHydrationWarning>
                      {formatTimestamp(intent.timestamp, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>

                {intent.matched_session_id && (
                  <div className="p-3 rounded bg-muted border border-border">
                    <p className="text-sm text-muted-foreground uppercase tracking-wider">Matched session</p>
                    <div className="mt-1 text-sm break-all tabular-nums">
                      {intent.matched_session_id}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-destructive text-sm mb-2">Error: {error}</p>
            </div>
          ) : !session ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-sm">No matched session found</p>
            </div>
          ) : (
            <>
              {/* Session Timeline */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold uppercase tracking-wider mb-3">
                  Session Timeline
                </h4>
                <SessionGroup siteId={siteId} sessionId={session.id} events={session.events.filter(e => e.event_category !== 'heartbeat')} />
              </div>

              {/* Technical Details */}
              <div className="border-t border-border pt-6">
                <h4 className="text-sm font-semibold uppercase tracking-wider mb-3">
                  Technical Details
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Session ID:</span>
                    <code className="ml-2 text-muted-foreground break-all tabular-nums">{session.id}</code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">IP:</span>
                    <span className="ml-2 text-muted-foreground">{'—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">User Agent:</span>
                    <span className="ml-2 text-muted-foreground truncate block">{'—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="ml-2 text-muted-foreground tabular-nums">
                      {session.events.length > 1
                        ? formatDuration(
                          Math.floor(
                            (new Date(session.events[session.events.length - 1].created_at).getTime() -
                              new Date(session.events[0].created_at).getTime()) /
                            1000
                          )
                        )
                        : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created:</span>
                    <span className="ml-2 text-muted-foreground tabular-nums">
                      {formatTimestamp(session.created_at, {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Events:</span>
                    <span className="ml-2 text-muted-foreground tabular-nums">{session.events.length}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
