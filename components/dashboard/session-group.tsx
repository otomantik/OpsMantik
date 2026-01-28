'use client';

import React, { useState, useEffect, memo, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Phone, MapPin, TrendingUp, ChevronDown, ChevronUp, CheckCircle2, Clock, Copy, ChevronRight, History, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { useVisitorHistory } from '@/lib/hooks/use-visitor-history';
import { formatTimestamp } from '@/lib/utils';

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

interface Event {
  id: string;
  event_category: string;
  event_action: string;
  event_label: string | null;
  event_value: number | null;
  metadata: any;
  created_at: string;
  url?: string;
}

interface SessionGroupProps {
  siteId?: string;
  sessionId: string;
  events: Event[];
  adsOnly?: boolean;
}

export const SessionGroup = memo(function SessionGroup({ siteId, sessionId, events, adsOnly = false }: SessionGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showVisitorHistory, setShowVisitorHistory] = useState(false);
  const [matchedCall, setMatchedCall] = useState<any>(null);
  const [isLoadingCall, setIsLoadingCall] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [adsGateChecked, setAdsGateChecked] = useState(false);
  const [isExcludedByAdsOnly, setIsExcludedByAdsOnly] = useState(false);
  const [sessionData, setSessionData] = useState<{
    attribution_source?: string | null;
    device_type?: string | null;
    city?: string | null;
    district?: string | null;
    fingerprint?: string | null;
    gclid?: string | null;
    site_id?: string | null;
  } | null>(null);
  
  const firstEvent = events[events.length - 1]; // Oldest event
  const lastEvent = events[0]; // Newest event
  const metadata = firstEvent.metadata || {};
  const leadScore = metadata.lead_score || 0;
  
  // Fetch session data (normalized fields) - fallback to event metadata
  // Also fetch site_id for visitor history
  useEffect(() => {
    const fetchSessionData = async () => {
      if (!siteId) return;
      const supabase = createClient();
      const { data: sessionRows, error } = await supabase.rpc('get_session_details', {
        p_site_id: siteId,
        p_session_id: sessionId,
      });

      if (error && shouldLogSessionsErrorsThisRun()) {
        const e = error as any;
        const payload = {
          code: e?.code,
          message: e?.message,
          details: e?.details,
          hint: e?.hint,
          status: e?.status,
          name: e?.name,
        };
        console.log('[DEBUG][sessions][SessionGroup] failing query context', {
          rpc: 'get_session_details',
          args: { p_site_id: siteId, p_session_id: sessionId },
        });
        console.log('[DEBUG][sessions][SessionGroup] error payload', payload);
        try {
          console.log('[DEBUG][sessions][SessionGroup] error JSON', JSON.stringify(e));
        } catch {
          // ignore
        }
      }

      if (sessionRows && Array.isArray(sessionRows) && sessionRows[0]) {
        const session = sessionRows[0] as any;
        setSessionData({
          attribution_source: session.attribution_source ?? null,
          device_type: session.device_type ?? null,
          city: session.city ?? null,
          district: session.district ?? null,
          fingerprint: session.fingerprint ?? null,
          gclid: session.gclid ?? null,
          site_id: session.site_id ?? null,
        });
        setIsExcludedByAdsOnly(false);
      } else if (adsOnly) {
        // In Ads-only mode, session details RPC is the gate:
        // it returns rows ONLY for Ads-origin sessions. If empty/denied => exclude from UI.
        setIsExcludedByAdsOnly(true);
      }
      setAdsGateChecked(true);
    };
    
    fetchSessionData();
  }, [siteId, sessionId, adsOnly]);

  // Use session data first, fallback to event metadata (before any early return so hook count is stable)
  // Note: computeAttribution always returns a value, so 'Organic' fallback is redundant
  const attributionSource = sessionData?.attribution_source || metadata.attribution_source;
  const intelligenceSummary = metadata.intelligence_summary || 'Standard Traffic';
  const gclid = sessionData?.gclid || metadata.gclid || null;
  
  // Get fingerprint and site_id for visitor history
  const fingerprint = sessionData?.fingerprint || metadata.fingerprint || metadata.fp || null;
  const effectiveSiteId = (sessionData as any)?.site_id || siteId || null;
  
  // Fetch visitor history if fingerprint and siteId are available
  const { sessions: visitorSessions, calls: visitorCalls, sessionCount24h, isReturning, isLoading: isLoadingHistory } = useVisitorHistory(
    effectiveSiteId || '',
    fingerprint
  );
  
  // Context chips data - prefer session, fallback to metadata
  const city = sessionData?.city || metadata.city || null;
  const district = sessionData?.district || metadata.district || null;
  const device = sessionData?.device_type || metadata.device_type || null;
  const os = metadata.os || null;
  const browser = metadata.browser || null;

  // Check for matched call when component mounts or session changes
  // FIX: Use matched_session_id instead of fingerprint to prevent fingerprint leakage
  useEffect(() => {
    if (!sessionId) return;

    setIsLoadingCall(true);
    const supabase = createClient();
    
    // Use JOIN pattern for RLS compliance - calls -> sites -> user_id
    // Contract: MATCHED badge shows ONLY when call.matched_session_id === session.id
    // Iron Dome: Add explicit site_id scope for defense in depth
    const siteIdForQuery = (sessionData as any)?.site_id;
    if (!siteIdForQuery) {
      setIsLoadingCall(false);
      return;
    }
    supabase
      .from('calls')
      .select('*, sites!inner(user_id)')
      .eq('matched_session_id', sessionId)
      .eq('site_id', siteIdForQuery) // Iron Dome: explicit site_id scope
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          // Silently ignore RLS errors (call might belong to another user)
          console.log('[SESSION_GROUP] Call lookup error (RLS?):', error.message);
          setIsLoadingCall(false);
          return;
        }
        if (data) {
          setMatchedCall(data);
        }
        setIsLoadingCall(false);
      });
  }, [sessionId, sessionData]);

  // Event compression (hook) MUST be before any early return (React 310).
  // Compute from raw `events` to avoid depending on later variables.
  type EventWithTimeDiff = Event & { timeDiff: number };
  interface CompressedEvent {
    type: 'single' | 'group';
    id: string; // For single events, use event.id; for groups, use composite key
    event?: EventWithTimeDiff; // Single event
    events?: EventWithTimeDiff[]; // Grouped events
    count?: number; // Count for groups
    firstTime: string; // First event time in group
    lastTime: string; // Last event time in group
    timeDiff: number; // Time diff from previous item
  }

  const compressedEvents = useMemo<CompressedEvent[]>(() => {
    const COMPRESSION_WINDOW_MS = 2000; // 2 seconds
    const sorted = [...events].sort((a, b) => {
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    const eventsWithTimeDiff: EventWithTimeDiff[] = sorted.map((event, index) => {
      const timeDiff =
        index > 0
          ? Math.round((new Date(event.created_at).getTime() - new Date(sorted[index - 1].created_at).getTime()) / 1000)
          : 0;
      return { ...event, timeDiff };
    });

    const result: CompressedEvent[] = [];
    if (eventsWithTimeDiff.length === 0) return result;

    let i = 0;
    while (i < eventsWithTimeDiff.length) {
      const currentEvent = eventsWithTimeDiff[i];
      const currentTime = new Date(currentEvent.created_at).getTime();

      // Check if we can group with following events
      const group: EventWithTimeDiff[] = [currentEvent];
      let j = i + 1;

      while (j < eventsWithTimeDiff.length) {
        const nextEvent = eventsWithTimeDiff[j];
        const nextTime = new Date(nextEvent.created_at).getTime();
        const timeDiff = nextTime - currentTime;

        // Check if within compression window and identical
        if (timeDiff <= COMPRESSION_WINDOW_MS) {
          const isIdentical =
            currentEvent.event_category === nextEvent.event_category &&
            currentEvent.event_action === nextEvent.event_action &&
            currentEvent.event_label === nextEvent.event_label;

          if (isIdentical) {
            group.push(nextEvent);
            j++;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      // Create compressed item
      if (group.length > 1) {
        const groupKey = `group-${currentEvent.id}-${group[group.length - 1].id}`;
        result.push({
          type: 'group',
          id: groupKey,
          events: group,
          count: group.length,
          firstTime: group[0].created_at,
          lastTime: group[group.length - 1].created_at,
          timeDiff:
            result.length > 0
              ? Math.round(
                  (new Date(group[0].created_at).getTime() -
                    new Date(result[result.length - 1].lastTime || result[result.length - 1].event!.created_at).getTime()) /
                    1000
                )
              : 0,
        });
      } else {
        result.push({
          type: 'single',
          id: currentEvent.id,
          event: currentEvent,
          firstTime: currentEvent.created_at,
          lastTime: currentEvent.created_at,
          timeDiff:
            result.length > 0
              ? Math.round(
                  (new Date(currentEvent.created_at).getTime() -
                    new Date(result[result.length - 1].lastTime || result[result.length - 1].event!.created_at).getTime()) /
                    1000
                )
              : 0,
        });
      }

      i = j;
    }

    return result;
  }, [events]);

  // Ads-only mode: don't render anything until gate check completes (prevents non-ads flash)
  // MUST be after ALL hooks to avoid React "Rendered more hooks than during the previous render" (310)
  if (adsOnly && !adsGateChecked) {
    return null;
  }
  if (adsOnly && isExcludedByAdsOnly) {
    return null;
  }

  // Get icon for event action
  const getEventIcon = (action: string | null | undefined) => {
    if (!action) return TrendingUp;
    const actionLower = action.toLowerCase();
    if (actionLower.includes('phone') || actionLower.includes('call') || actionLower.includes('whatsapp')) {
      return Phone;
    }
    if (actionLower.includes('page') || actionLower.includes('visit') || actionLower.includes('external') || actionLower.includes('hover')) {
      return MapPin;
    }
    return TrendingUp;
  };

  // Get border color based on lead score
  const getBorderColor = (score: number) => {
    if (score >= 71) {
      return 'border-amber-300';
    }
    if (score >= 31) {
      return 'border-blue-200';
    }
    return 'border-border';
  };

  // Get border glow for hot leads
  const getBorderGlow = (score: number) => {
    return {};
  };

  // Sort events by time (oldest to newest) with id tie-breaker for determinism
  const sortedEvents = [...events].sort((a, b) => {
    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    // Tie-breaker: use id for deterministic order
    return a.id.localeCompare(b.id);
  });

  // Calculate session duration
  const sessionDuration = sortedEvents.length > 1
    ? Math.round((new Date(lastEvent.created_at).getTime() - new Date(firstEvent.created_at).getTime()) / 1000)
    : 0;

  // Count conversions
  const conversionCount = events.filter(e => e.event_category === 'conversion').length;
  const hasPhoneCall = events.some(e => 
    e.event_action?.toLowerCase().includes('phone') || 
    e.event_action?.toLowerCase().includes('call')
  );

  // Calculate time differences between events
  const eventsWithTimeDiff = sortedEvents.map((event, index) => {
    const timeDiff = index > 0 
      ? Math.round((new Date(event.created_at).getTime() - new Date(sortedEvents[index - 1].created_at).getTime()) / 1000)
      : 0;
    return { ...event, timeDiff };
  });

  const handleCopySessionId = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent accordion toggle
    try {
      await navigator.clipboard.writeText(sessionId);
    } catch (err) {
      console.error('[SESSION_GROUP] Failed to copy session ID:', err);
    }
  };

  const handleCopyFingerprint = async (e: React.MouseEvent, fullFingerprint: string) => {
    e.stopPropagation(); // Prevent accordion toggle
    try {
      await navigator.clipboard.writeText(fullFingerprint);
    } catch (err) {
      console.error('[SESSION_GROUP] Failed to copy fingerprint:', err);
    }
  };

  const handleToggleVisitorHistory = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent accordion toggle
    setShowVisitorHistory(!showVisitorHistory);
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  return (
    <Card 
      className={`${getBorderColor(leadScore)} transition-all duration-300`}
      style={getBorderGlow(leadScore)}
      data-session-id={sessionId}
    >
      <CardContent className="p-0">
        {/* Clickable Header */}
        <div 
          className="p-4 cursor-pointer hover:bg-muted transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-semibold text-foreground truncate">
                  Session: <span className="text-emerald-700">{sessionId.slice(0, 8)}…</span>
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 p-0 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10"
                  onClick={handleCopySessionId}
                  title="Copy Session ID"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <p className="font-mono text-xs text-slate-500">
                    {formatTimestamp(firstEvent.created_at, {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </p>
                </div>
                {sessionDuration > 0 && (
                  <span className="font-mono text-sm px-2 py-1 rounded bg-slate-700/50 text-slate-300">
                    {sessionDuration}s
                  </span>
                )}
                <span className="font-mono text-sm px-2 py-1 rounded bg-slate-700/50 text-slate-300">
                  {events.length} events
                </span>
                {conversionCount > 0 && (
                  <span className="font-mono text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold">
                    {conversionCount} CONVERSION{conversionCount > 1 ? 'S' : ''}
                  </span>
                )}
                {hasPhoneCall && (
                  <span className="font-mono text-sm px-2 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    📞 CALL
                  </span>
                )}
                {matchedCall && (
                  <span className="font-mono text-sm px-2 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    MATCHED: {matchedCall.phone_number}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className={`font-mono text-3xl font-bold ${
                leadScore >= 71 ? 'text-orange-400' : 
                leadScore >= 31 ? 'text-blue-400' : 
                'text-slate-400'
              }`}>
                {leadScore}
              </p>
              {leadScore >= 71 && (
                <p className="font-mono text-xs text-orange-400 animate-pulse font-semibold mt-1">HOT LEAD</p>
              )}
              <p className="font-mono text-sm text-slate-600 uppercase tracking-wider mt-2 opacity-60">
                {intelligenceSummary}
              </p>
            </div>
          </div>
          
          {/* Quick Info Row - Badge Style */}
          <div className="mt-3 pt-2 border-t border-slate-800/50">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs px-2 py-1 rounded bg-slate-700/50 text-slate-300 border border-slate-600/30">
                SOURCE: <span className="text-slate-100 font-semibold">{attributionSource}</span>
              </span>
              {gclid && (
                <span className="font-mono text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
                  GCLID: <span className="text-purple-300">{gclid.slice(0, 12)}...</span>
                </span>
              )}
              {fingerprint && (
                <span 
                  className="font-mono text-xs px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center gap-1 cursor-pointer hover:bg-cyan-500/30 transition-colors"
                  title={`Fingerprint: ${fingerprint}\nClick to copy full fingerprint`}
                  onClick={(e) => handleCopyFingerprint(e, fingerprint)}
                >
                  FP: <span className="text-cyan-300">{fingerprint.slice(0, 10)}...</span>
                  <Copy className="w-3 h-3 opacity-60" />
                </span>
              )}
              {isReturning && (
                <span className="font-mono text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/30 font-semibold">
                  🔄 RETURNING
                </span>
              )}
              {sessionCount24h > 0 && (
                <span className="font-mono text-sm px-2 py-1 rounded bg-slate-700/50 text-slate-300">
                  Sessions 24h: {sessionCount24h}
                </span>
              )}
              {fingerprint && siteId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-3 text-sm font-mono text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10"
                  onClick={handleToggleVisitorHistory}
                  title="View visitor history"
                >
                  <History className="w-3 h-3 mr-1" />
                  History
                </Button>
              )}
            </div>
          </div>

          {/* Context Chips Row - Always show, use "—" for missing values */}
          <div className="mt-2 pt-2 border-t border-slate-800/30">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 min-w-0 truncate">
                CITY: <span className="text-indigo-300 font-semibold">{city && city !== 'Unknown' ? city : '—'}</span>
              </span>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 min-w-0 truncate">
                DISTRICT: <span className="text-violet-300 font-semibold">{district || '—'}</span>
              </span>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 min-w-0 truncate">
                DEVICE: <span className="text-amber-300 font-semibold">{device || '—'}</span>
              </span>
              {os && os !== 'Unknown' && (
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-teal-500/20 text-teal-400 border border-teal-500/30 min-w-0 truncate">
                  OS: <span className="text-teal-300 font-semibold">{os}</span>
                </span>
              )}
              {browser && browser !== 'Unknown' && (
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 min-w-0 truncate">
                  BROWSER: <span className="text-sky-300 font-semibold">{browser}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Expanded Content - Event Timeline & Time Table */}
        {isExpanded && (
          <div className="border-t border-slate-800/50 p-4 space-y-4">
            {/* Event Timeline (Visual) */}
            <div>
              <p className="font-mono text-xs text-slate-400 uppercase tracking-wider mb-3">
                Event Timeline
              </p>
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {(sortedEvents || []).slice(0, 15).map((event, index) => {
                  const Icon = getEventIcon(event?.event_action);
                  const isLast = index === sortedEvents.slice(0, 15).length - 1;
                  const isConversion = event.event_category === 'conversion';
                  
                  return (
                    <div key={event.id} className="flex items-center gap-1 flex-shrink-0">
                      <div className="relative group">
                        <div className={`
                          w-8 h-8 rounded-full flex items-center justify-center
                          ${isConversion ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                            event.event_category === 'acquisition' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                            'bg-slate-700/50 text-slate-300 border border-slate-600/30'
                          }
                          hover:scale-110 transition-transform cursor-pointer
                        `}>
                          <Icon className="w-4 h-4" />
                        </div>
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                          <div className="bg-slate-800 text-slate-200 text-xs font-mono px-2 py-1 rounded border border-slate-700 whitespace-nowrap">
                            {event.event_action}
                            {event.event_label && `: ${event.event_label}`}
                          </div>
                        </div>
                      </div>
                      {!isLast && (
                        <TrendingUp className="w-3 h-3 text-slate-600 flex-shrink-0" />
                      )}
                    </div>
                  );
                })}
                {events.length > 15 && (
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <TrendingUp className="w-3 h-3 text-slate-600" />
                    <span className="font-mono text-sm px-2 py-1 rounded bg-slate-800/50 text-slate-400 border border-slate-700/30">
                      +{events.length - 15}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Event Details Table */}
            <div>
              <p className="font-mono text-xs text-slate-400 uppercase tracking-wider mb-3">
                Event Details & Time Table
              </p>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-800/50">
                      <th className="text-left py-2 px-3 text-slate-400">Time</th>
                      <th className="text-left py-2 px-3 text-slate-400">+Time</th>
                      <th className="text-left py-2 px-3 text-slate-400">Category</th>
                      <th className="text-left py-2 px-3 text-slate-400">Action</th>
                      <th className="text-left py-2 px-3 text-slate-400">Label</th>
                      <th className="text-left py-2 px-3 text-slate-400">Value</th>
                      <th className="text-left py-2 px-3 text-slate-400">URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(compressedEvents || []).map((item) => {
                      if (item.type === 'single' && item.event) {
                        // Single event (no compression)
                        const event = item.event;
                        const Icon = getEventIcon(event.event_action);
                        const isConversion = event.event_category === 'conversion';
                        
                        return (
                          <tr 
                            key={item.id} 
                            className={`border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors ${
                              isConversion ? 'bg-emerald-500/5' : ''
                            }`}
                          >
                            <td className="py-2 px-3 text-slate-300">
                              {formatTimestamp(event.created_at, {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                fractionalSecondDigits: 3
                              })}
                            </td>
                            <td className="py-2 px-3 text-slate-500">
                              {item.timeDiff > 0 ? `+${item.timeDiff}s` : '—'}
                            </td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-1 rounded text-sm ${
                                event.event_category === 'conversion' ? 'bg-emerald-500/20 text-emerald-400' :
                                event.event_category === 'acquisition' ? 'bg-blue-500/20 text-blue-400' :
                                event.event_category === 'interaction' ? 'bg-purple-500/20 text-purple-400' :
                                'bg-slate-700/50 text-slate-300'
                              }`}>
                                {event.event_category.toUpperCase()}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-200 flex items-center gap-2">
                              <Icon className="w-3 h-3" />
                              {event.event_action}
                            </td>
                            <td className="py-2 px-3 text-slate-400">
                              {event.event_label || '—'}
                            </td>
                            <td className="py-2 px-3 text-slate-400">
                              {event.event_value !== null ? event.event_value : '—'}
                            </td>
                            <td className="py-2 px-3 text-slate-500 text-sm max-w-xs truncate" title={event.url}>
                              {event.url || '—'}
                            </td>
                          </tr>
                        );
                      } else if (item.type === 'group' && item.events) {
                        // Compressed group
                        const firstEvent = item.events[0];
                        const Icon = getEventIcon(firstEvent.event_action);
                        const isConversion = firstEvent.event_category === 'conversion';
                        const isExpanded = expandedGroups.has(item.id);
                        
                        return (
                          <React.Fragment key={item.id}>
                            {/* Compressed row */}
                            <tr 
                              className={`border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors cursor-pointer ${
                                isConversion ? 'bg-emerald-500/5' : ''
                              }`}
                              onClick={() => toggleGroup(item.id)}
                            >
                              <td className="py-2 px-3 text-slate-300">
                                {formatTimestamp(item.firstTime, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  fractionalSecondDigits: 3
                                })}
                                {item.events.length > 1 && (
                                  <span className="text-slate-500 ml-1">
                                    - {formatTimestamp(item.lastTime, {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit',
                                      fractionalSecondDigits: 3
                                    })}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-slate-500">
                                {item.timeDiff > 0 ? `+${item.timeDiff}s` : '—'}
                              </td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-1 rounded text-sm ${
                                  firstEvent.event_category === 'conversion' ? 'bg-emerald-500/20 text-emerald-400' :
                                  firstEvent.event_category === 'acquisition' ? 'bg-blue-500/20 text-blue-400' :
                                  firstEvent.event_category === 'interaction' ? 'bg-purple-500/20 text-purple-400' :
                                  'bg-slate-700/50 text-slate-300'
                                }`}>
                                  {firstEvent.event_category.toUpperCase()}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-200 flex items-center gap-2">
                                <ChevronRight 
                                  className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                />
                                <Icon className="w-3 h-3" />
                                {firstEvent.event_action}
                                <span className="ml-2 px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-sm font-semibold">
                                  ×{item.count}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-400">
                                {firstEvent.event_label || '—'}
                              </td>
                              <td className="py-2 px-3 text-slate-400">
                                {firstEvent.event_value !== null ? firstEvent.event_value : '—'}
                              </td>
                              <td className="py-2 px-3 text-slate-500 text-sm max-w-xs truncate" title={firstEvent.url}>
                                {firstEvent.url || '—'}
                              </td>
                            </tr>
                            {/* Expanded rows (if toggled) */}
                            {isExpanded && item.events.map((event, idx) => (
                              <tr 
                                key={`${item.id}-${event.id}`}
                                className={`border-b border-slate-800/20 hover:bg-slate-800/10 transition-colors ${
                                  isConversion ? 'bg-emerald-500/3' : ''
                                }`}
                              >
                                <td className="py-1.5 px-3 pl-8 text-slate-400 text-sm">
                                  {formatTimestamp(event.created_at, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                    fractionalSecondDigits: 3
                                  })}
                                </td>
                                <td className="py-1.5 px-3 text-slate-500 text-sm">
                                  {event.timeDiff > 0 ? `+${event.timeDiff}s` : '—'}
                                </td>
                                <td className="py-1.5 px-3">
                                  <span className={`px-2 py-1 rounded text-sm ${
                                    event.event_category === 'conversion' ? 'bg-emerald-500/20 text-emerald-400' :
                                    event.event_category === 'acquisition' ? 'bg-blue-500/20 text-blue-400' :
                                    event.event_category === 'interaction' ? 'bg-purple-500/20 text-purple-400' :
                                    'bg-slate-700/50 text-slate-300'
                                  }`}>
                                    {event.event_category.toUpperCase()}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3 text-slate-300 text-sm flex items-center gap-2">
                                  <Icon className="w-2.5 h-2.5" />
                                  {event.event_action}
                                </td>
                                <td className="py-1.5 px-3 text-slate-500 text-sm">
                                  {event.event_label || '—'}
                                </td>
                                <td className="py-1.5 px-3 text-slate-500 text-sm">
                                  {event.event_value !== null ? event.event_value : '—'}
                                </td>
                                <td className="py-1.5 px-3 text-slate-600 text-sm max-w-xs truncate" title={event.url}>
                                  {event.url || '—'}
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      }
                      return null;
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Phone Match Info */}
            {matchedCall && (
              <div className="mt-4 p-3 rounded bg-rose-500/10 border border-rose-500/30">
                <p className="font-mono text-xs text-rose-400 mb-1">
                  📞 TELEFON EŞLEŞTİ: {matchedCall.phone_number}
                </p>
                <div className="flex items-center gap-4 text-sm text-slate-400">
                  <span>Score: {matchedCall.lead_score}</span>
                  <span>Match Time: {formatTimestamp(matchedCall.created_at)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
      
      {/* Visitor History Drawer */}
      {showVisitorHistory && fingerprint && siteId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end lg:items-center justify-center p-4">
          <Card className="w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <CardContent className="p-0 flex flex-col h-full">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Visitor History</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Fingerprint: <span className="text-foreground tabular-nums">{fingerprint.slice(0, 10)}…</span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowVisitorHistory(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              
              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {isLoadingHistory ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">Loading visitor history...</p>
                  </div>
                ) : !visitorSessions || visitorSessions.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">No previous sessions found for this visitor</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(visitorSessions || []).map((session) => (
                      <div
                        key={session.id}
                        className={`p-3 rounded border ${
                          session.id === sessionId
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : 'bg-slate-800/30 border-slate-700/30'
                        } hover:bg-slate-800/50 transition-colors`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className="font-mono text-xs text-slate-300">
                                {formatTimestamp(session.created_at, {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {session.id === sessionId && (
                                <span className="font-mono text-sm px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                  CURRENT
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {session.attribution_source && (
                                <span className="font-mono text-sm px-2 py-1 rounded bg-slate-700/50 text-slate-300">
                                  {session.attribution_source}
                                </span>
                              )}
                              {session.device_type && (
                                <span className="font-mono text-sm px-2 py-1 rounded bg-amber-500/20 text-amber-400">
                                  {session.device_type}
                                </span>
                              )}
                              {session.city && session.city !== 'Unknown' && (
                                <span className="font-mono text-sm px-2 py-1 rounded bg-indigo-500/20 text-indigo-400">
                                  {session.city}
                                </span>
                              )}
                              {session.lead_score !== null && session.lead_score !== undefined && (
                                <span className={`font-mono text-sm px-2 py-1 rounded ${
                                  session.lead_score >= 71 ? 'bg-orange-500/20 text-orange-400' :
                                  session.lead_score >= 31 ? 'bg-blue-500/20 text-blue-400' :
                                  'bg-slate-700/50 text-slate-300'
                                }`}>
                                  Score: {session.lead_score}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-xs text-slate-500">
                              {session.id.slice(0, 8)}...
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Other Calls Section - Fingerprint-only calls */}
                {visitorCalls && visitorCalls.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-800/50">
                    <h4 className="font-mono text-sm text-slate-300 mb-3">Other Calls (Same Fingerprint)</h4>
                    <div className="space-y-2">
                      {(visitorCalls || []).map((call) => (
                        <div
                          key={call.id}
                          className="p-3 rounded bg-slate-800/30 border border-slate-700/30 hover:bg-slate-800/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <span className="font-mono text-xs text-slate-300">{call.phone_number}</span>
                                <span className="font-mono text-sm px-2 py-1 rounded bg-slate-700/50 text-slate-300">
                                  Score: {call.lead_score}
                                </span>
                                {call.matched_session_id && (
                                  <span className="font-mono text-sm px-2 py-1 rounded bg-cyan-500/20 text-cyan-400">
                                    Matched to: {call.matched_session_id.slice(0, 8)}...
                                  </span>
                                )}
                              </div>
                              <span className="font-mono text-sm text-slate-500">
                                {formatTimestamp(call.created_at, {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Footer */}
              <div className="p-4 border-t border-slate-800/50 bg-slate-900/50">
                <p className="font-mono text-xs text-slate-400 text-center">
                  Showing {visitorSessions.length} session{visitorSessions.length !== 1 ? 's' : ''} 
                  {visitorCalls.length > 0 && `, ${visitorCalls.length} other call${visitorCalls.length !== 1 ? 's' : ''}`}
                  {sessionCount24h > 0 && ` • ${sessionCount24h} in last 24h`}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </Card>
  );
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if sessionId or events array reference changes
  return prevProps.sessionId === nextProps.sessionId && 
         prevProps.events === nextProps.events;
});
