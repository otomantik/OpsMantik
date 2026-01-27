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
  ip: string | null;
  user_agent: string | null;
  fingerprint: string | null;
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

  useEffect(() => {
    if (!intent.matched_session_id) {
      setIsLoading(false);
      return;
    }

    const fetchSession = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const supabase = createClient();

        // Fetch session
        const { data: sessionData, error: sessionError } = await supabase
          .from('sessions')
          .select('id, created_at, city, district, device_type, ip, user_agent, fingerprint, created_month')
          .eq('id', intent.matched_session_id)
          .eq('site_id', siteId)
          .single();

        if (sessionError) throw sessionError;

        // Fetch events
        const { data: eventsData, error: eventsError } = await supabase
          .from('events')
          .select('id, event_category, event_action, event_label, event_value, metadata, created_at, url, session_month')
          .eq('session_id', intent.matched_session_id)
          .eq('session_month', sessionData.created_month)
          .order('created_at', { ascending: true });

        if (eventsError) throw eventsError;

        setSession({
          id: sessionData.id,
          created_at: sessionData.created_at,
          city: sessionData.city,
          district: sessionData.district,
          device_type: sessionData.device_type,
          ip: sessionData.ip,
          user_agent: sessionData.user_agent,
          fingerprint: sessionData.fingerprint,
          events: eventsData || [],
        });
      } catch (err: unknown) {
        console.error('[SessionDrawer] Error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch session';
        setError(errorMessage);
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
      <div className="relative w-full sm:w-[600px] sm:max-w-full h-[90vh] sm:h-auto sm:max-h-[90vh] bg-slate-900 border-t sm:border border-slate-800 rounded-t-lg sm:rounded-lg shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h3 className="text-sm font-mono text-slate-200 uppercase tracking-tighter">
            Oturum Detayları
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 text-slate-600 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-rose-400 font-mono text-sm mb-2">Hata: {error}</p>
            </div>
          ) : !session ? (
            <div className="text-center py-12">
              <p className="text-slate-500 font-mono text-sm">Eşleşmiş oturum bulunamadı</p>
            </div>
          ) : (
            <>
              {/* Session Timeline */}
              <div className="mb-6">
                <h4 className="text-xs font-mono text-slate-300 uppercase tracking-wider mb-3">
                  Oturum Zaman Çizelgesi
                </h4>
                <SessionGroup sessionId={session.id} events={session.events.filter(e => e.event_category !== 'heartbeat')} />
              </div>

              {/* Technical Details */}
              <div className="border-t border-slate-800 pt-6">
                <h4 className="text-xs font-mono text-slate-300 uppercase tracking-wider mb-3">
                  Teknik Detaylar
                </h4>
                <div className="grid grid-cols-2 gap-4 text-[11px] font-mono">
                  <div>
                    <span className="text-slate-500">Session ID:</span>
                    <code className="ml-2 text-slate-400 text-[10px] break-all">{session.id}</code>
                  </div>
                  <div>
                    <span className="text-slate-500">IP:</span>
                    <span className="ml-2 text-slate-400">{session.ip || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">User Agent:</span>
                    <span className="ml-2 text-slate-400 truncate block">{session.user_agent || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Süre:</span>
                    <span className="ml-2 text-slate-400">
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
                    <span className="text-slate-500">Oluşturulma:</span>
                    <span className="ml-2 text-slate-400">
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
                    <span className="text-slate-500">Etkinlikler:</span>
                    <span className="ml-2 text-slate-400">{session.events.length}</span>
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
