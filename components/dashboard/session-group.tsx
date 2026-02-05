'use client';

import React, { useState, useEffect, memo, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Phone, MapPin, TrendingUp, ChevronDown, ChevronUp, CheckCircle2, Clock, Copy, ChevronRight, History, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { useVisitorHistory } from '@/lib/hooks/use-visitor-history';
import { formatTimestamp, debugLog } from '@/lib/utils';
import { formatLocation } from '@/lib/utils/format-location';
import { logger } from '@/lib/logging/logger';

interface Event {
  id: string;
  event_category: string;
  event_action: string;
  event_label: string | null;
  event_value: number | null;
  metadata: Record<string, unknown>;
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
  const [matchedCall, setMatchedCall] = useState<{ id: string; phone_number?: string; matched_session_id?: string | null; lead_score?: number | null; created_at?: string } | null>(null);
  // isLoadingCall removed (unused)
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
  const leadScore = (typeof metadata.lead_score === 'number' ? metadata.lead_score : 0);

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

      if (error) {
        debugLog('[DEBUG][sessions][SessionGroup] get_session_details error', {
          p_site_id: siteId,
          p_session_id: sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (sessionRows && Array.isArray(sessionRows) && sessionRows[0]) {
        const session = sessionRows[0] as Record<string, unknown>;
        setSessionData({
          attribution_source: (session.attribution_source as string | null | undefined) ?? null,
          device_type: (session.device_type as string | null | undefined) ?? null,
          city: (session.city as string | null | undefined) ?? null,
          district: (session.district as string | null | undefined) ?? null,
          fingerprint: (session.fingerprint as string | null | undefined) ?? null,
          gclid: (session.gclid as string | null | undefined) ?? null,
          site_id: (session.site_id as string | null | undefined) ?? null,
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
  const attributionSource = (sessionData?.attribution_source ?? metadata.attribution_source ?? null) as string | null;
  const intelligenceSummary = (typeof metadata.intelligence_summary === 'string' ? metadata.intelligence_summary : 'Standard Traffic');
  const gclid = (sessionData?.gclid ?? metadata.gclid ?? null) as string | null;

  // Get fingerprint and site_id for visitor history
  const fingerprint = (sessionData?.fingerprint ?? metadata.fingerprint ?? metadata.fp ?? null) as string | null;
  const effectiveSiteId = (sessionData?.site_id ?? siteId) ?? null;

  // Fetch visitor history if fingerprint and siteId are available
  const { sessions: visitorSessions, calls: visitorCalls, sessionCount24h, isReturning, isLoading: isLoadingHistory } = useVisitorHistory(
    effectiveSiteId || '',
    fingerprint
  );

  // Context chips data - prefer session, fallback to metadata
  const city = (sessionData?.city ?? metadata.city ?? null) as string | null;
  const district = (sessionData?.district ?? metadata.district ?? null) as string | null;
  const device = (sessionData?.device_type ?? metadata.device_type ?? null) as string | null;
  const os = (metadata.os ?? null) as string | null;
  const browser = (metadata.browser ?? null) as string | null;
  const locationLabel = formatLocation(city, district);

  // Check for matched call when component mounts or session changes
  // FIX: Use matched_session_id instead of fingerprint to prevent fingerprint leakage
  useEffect(() => {
    if (!sessionId) return;

    const supabase = createClient();

    // Use JOIN pattern for RLS compliance - calls -> sites -> user_id
    // Contract: MATCHED badge shows ONLY when call.matched_session_id === session.id
    // Iron Dome: Add explicit site_id scope for defense in depth
    const siteIdForQuery = sessionData?.site_id;
    if (!siteIdForQuery) {
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
          debugLog('[SESSION_GROUP] Call lookup error (RLS?):', error.message);
          return;
        }
        if (data) {
          setMatchedCall(data);
        }
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
  const getBorderGlow = () => {
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


  const handleCopySessionId = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent accordion toggle
    try {
      await navigator.clipboard.writeText(sessionId);
    } catch (err) {
      logger.error('SESSION_GROUP failed to copy session ID', { error: String((err as Error)?.message ?? err) });
    }
  };

  const handleCopyFingerprint = async (e: React.MouseEvent, fullFingerprint: string) => {
    e.stopPropagation(); // Prevent accordion toggle
    try {
      await navigator.clipboard.writeText(fullFingerprint);
    } catch (err) {
      logger.error('SESSION_GROUP failed to copy fingerprint', { error: String((err as Error)?.message ?? err) });
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
      className={`bg-white border-slate-200 shadow-sm ${getBorderColor(leadScore)} transition-all duration-300`}
      style={getBorderGlow()}
      data-session-id={sessionId}
    >
      <CardContent className="p-0">
        {/* Clickable Header */}
        <div
          className="p-4 cursor-pointer hover:bg-slate-50 transition-colors"
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
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-emerald-700 hover:bg-emerald-50"
                  onClick={handleCopySessionId}
                  title="Copy Session ID"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
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
                  <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                    {sessionDuration}s
                  </span>
                )}
                <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                  {events.length} events
                </span>
                {conversionCount > 0 && (
                  <span className="text-sm px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium tabular-nums">
                    {conversionCount} CONVERSION{conversionCount > 1 ? 'S' : ''}
                  </span>
                )}
                {hasPhoneCall && (
                  <span className="text-sm px-2 py-1 rounded bg-blue-100 text-blue-700 border border-blue-200 font-medium">
                    Phone
                  </span>
                )}
                {matchedCall && (
                  <span className="text-sm px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    MATCHED: {matchedCall.phone_number}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className={`text-3xl font-bold tabular-nums ${leadScore >= 71 ? 'text-amber-700' :
                leadScore >= 31 ? 'text-blue-700' :
                  'text-muted-foreground'
                }`}>
                {leadScore}
              </p>
              {leadScore >= 71 && (
                <p className="text-sm text-amber-800 font-semibold mt-1">HOT LEAD</p>
              )}
              <p className="text-sm text-muted-foreground uppercase tracking-wider mt-2">
                {intelligenceSummary}
              </p>
            </div>
          </div>

          {/* Quick Info Row - Badge Style */}
          <div className="mt-3 pt-2 border-t border-border">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border">
                Source: <span className="text-foreground font-medium">{attributionSource}</span>
              </span>
              {gclid && (
                <span className="text-sm px-2 py-1 rounded bg-yellow-50 text-yellow-800 border border-yellow-200 tabular-nums">
                  GCLID: <span className="font-medium">{gclid.slice(0, 12)}…</span>
                </span>
              )}
              {fingerprint && (
                <span
                  className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border flex items-center gap-1 cursor-pointer hover:bg-muted/70 transition-colors tabular-nums"
                  title={`Fingerprint: ${fingerprint}\nClick to copy full fingerprint`}
                  onClick={(e) => handleCopyFingerprint(e, fingerprint)}
                >
                  FP: <span className="text-foreground font-medium">{fingerprint.slice(0, 10)}…</span>
                  <Copy className="w-3 h-3 opacity-60" />
                </span>
              )}
              {isReturning && (
                <span className="text-sm px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                  Returning
                </span>
              )}
              {sessionCount24h > 0 && (
                <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                  Sessions 24h: {sessionCount24h}
                </span>
              )}
              {fingerprint && siteId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted"
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
          <div className="mt-2 pt-2 border-t border-border">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                Location:{' '}
                <span className="text-foreground font-medium">
                  {locationLabel && locationLabel !== 'Unknown' ? locationLabel : '—'}
                </span>
              </span>
              <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                Device: <span className="text-foreground font-medium">{device || '—'}</span>
              </span>
              {os && os !== 'Unknown' && (
                <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                  OS: <span className="text-foreground font-medium">{os}</span>
                </span>
              )}
              {browser && browser !== 'Unknown' && (
                <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border min-w-0 truncate">
                  Browser: <span className="text-foreground font-medium">{browser}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Expanded Content - Event Timeline & Time Table */}
        {isExpanded && (
          <div className="border-t border-slate-200 p-4 space-y-4 bg-white">
            {/* Event Timeline (Visual) */}
            <div>
              <p className="text-sm text-muted-foreground uppercase tracking-wider mb-3">
                Event Timeline
              </p>
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {(sortedEvents || []).slice(0, 15).map((event, index) => {
                  const Icon = getEventIcon(event?.event_action);
                  const isLast = index === sortedEvents.slice(0, 15).length - 1;
                  const isConversion = event.event_category === 'conversion';

                  return (
                    <div key={event.id} className="flex items-center gap-1 shrink-0 ml-2">
                      <div className="relative group">
                        <div className={`
                          w-8 h-8 rounded-full flex items-center justify-center
                          ${isConversion ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            event.event_category === 'acquisition' ? 'bg-yellow-50 text-yellow-800 border border-yellow-200' :
                              'bg-white text-muted-foreground border border-slate-200'
                          }
                          hover:scale-110 transition-transform cursor-pointer
                        `}>
                          <Icon className="w-4 h-4" />
                        </div>
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                          <div className="bg-popover text-popover-foreground text-sm px-2 py-1 rounded border border-border whitespace-nowrap shadow-sm">
                            {event.event_action}
                            {event.event_label && `: ${event.event_label}`}
                          </div>
                        </div>
                      </div>
                      {!isLast && (
                        <TrendingUp className="w-3 h-3 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  );
                })}
                {events.length > 15 && (
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <TrendingUp className="w-3 h-3 text-muted-foreground" />
                    <span className="text-sm px-2 py-1 rounded bg-white text-muted-foreground border border-slate-200 tabular-nums">
                      +{events.length - 15}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Event Details Table */}
            <div>
              <p className="text-sm text-muted-foreground uppercase tracking-wider mb-3">
                Event Details & Time Table
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-muted-foreground">Time</th>
                      <th className="text-left py-2 px-3 text-muted-foreground">+Time</th>
                      <th className="text-left py-2 px-3 text-muted-foreground">Category</th>
                      <th className="text-left py-2 px-3 text-muted-foreground">Action</th>
                      <th className="text-left py-2 px-3 text-muted-foreground">Label</th>
                      <th className="text-left py-2 px-3 text-muted-foreground">Value</th>
                      <th className="text-left py-2 px-3 text-muted-foreground">URL</th>
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
                            className={`border-b border-slate-200 hover:bg-slate-50 transition-colors ${isConversion ? 'bg-emerald-50/50' : ''}`}
                          >
                            <td className="py-2 px-3 text-foreground tabular-nums" suppressHydrationWarning>
                              {formatTimestamp(event.created_at, {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                fractionalSecondDigits: 3
                              })}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground tabular-nums">
                              {item.timeDiff > 0 ? `+${item.timeDiff}s` : '—'}
                            </td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-1 rounded text-sm border ${event.event_category === 'conversion' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                event.event_category === 'acquisition' ? 'bg-yellow-50 text-yellow-800 border-yellow-200' :
                                  event.event_category === 'interaction' ? 'bg-white text-muted-foreground border-slate-200' :
                                    'bg-white text-muted-foreground border-slate-200'
                                }`}>
                                {event.event_category.toUpperCase()}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-foreground flex items-center gap-2">
                              <Icon className="w-3 h-3" />
                              {event.event_action}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground">
                              {event.event_label || '—'}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground tabular-nums">
                              {event.event_value !== null ? event.event_value : '—'}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground text-sm max-w-xs truncate" title={event.url}>
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
                              className={`border-b border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer ${isConversion ? 'bg-emerald-50/50' : ''}`}
                              onClick={() => toggleGroup(item.id)}
                            >
                              <td className="py-2 px-3 text-foreground tabular-nums" suppressHydrationWarning>
                                {formatTimestamp(item.firstTime, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  fractionalSecondDigits: 3
                                })}
                                {item.events.length > 1 && (
                                  <span className="text-muted-foreground ml-1 tabular-nums" suppressHydrationWarning>
                                    - {formatTimestamp(item.lastTime, {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit',
                                      fractionalSecondDigits: 3
                                    })}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground tabular-nums">
                                {item.timeDiff > 0 ? `+${item.timeDiff}s` : '—'}
                              </td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-1 rounded text-sm border ${firstEvent.event_category === 'conversion' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                  firstEvent.event_category === 'acquisition' ? 'bg-yellow-50 text-yellow-800 border-yellow-200' :
                                    firstEvent.event_category === 'interaction' ? 'bg-white text-muted-foreground border-slate-200' :
                                      'bg-white text-muted-foreground border-slate-200'
                                  }`}>
                                  {firstEvent.event_category.toUpperCase()}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-foreground flex items-center gap-2">
                                <ChevronRight
                                  className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                />
                                <Icon className="w-3 h-3" />
                                {firstEvent.event_action}
                                <span className="ml-2 px-2 py-1 rounded bg-muted text-muted-foreground border border-border text-sm font-semibold tabular-nums">
                                  ×{item.count}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">
                                {firstEvent.event_label || '—'}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground tabular-nums">
                                {firstEvent.event_value !== null ? firstEvent.event_value : '—'}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground text-sm max-w-xs truncate" title={firstEvent.url}>
                                {firstEvent.url || '—'}
                              </td>
                            </tr>
                            {/* Expanded rows (if toggled) */}
                            {isExpanded && item.events.map((event) => (
                              <tr
                                key={`${item.id}-${event.id}`}
                                className={`border-b border-slate-200 hover:bg-slate-50 transition-colors ${isConversion ? 'bg-emerald-50/30' : ''}`}
                              >
                                <td className="py-1.5 px-3 pl-8 text-muted-foreground text-sm tabular-nums" suppressHydrationWarning>
                                  {formatTimestamp(event.created_at, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                    fractionalSecondDigits: 3
                                  })}
                                </td>
                                <td className="py-1.5 px-3 text-muted-foreground text-sm tabular-nums">
                                  {event.timeDiff > 0 ? `+${event.timeDiff}s` : '—'}
                                </td>
                                <td className="py-1.5 px-3">
                                  <span className={`px-2 py-1 rounded text-sm border ${event.event_category === 'conversion' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                    event.event_category === 'acquisition' ? 'bg-yellow-50 text-yellow-800 border-yellow-200' :
                                      event.event_category === 'interaction' ? 'bg-white text-muted-foreground border-slate-200' :
                                        'bg-white text-muted-foreground border-slate-200'
                                    }`}>
                                    {event.event_category.toUpperCase()}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3 text-foreground text-sm flex items-center gap-2">
                                  <Icon className="w-2.5 h-2.5" />
                                  {event.event_action}
                                </td>
                                <td className="py-1.5 px-3 text-muted-foreground text-sm">
                                  {event.event_label || '—'}
                                </td>
                                <td className="py-1.5 px-3 text-muted-foreground text-sm tabular-nums">
                                  {event.event_value !== null ? event.event_value : '—'}
                                </td>
                                <td className="py-1.5 px-3 text-muted-foreground text-sm max-w-xs truncate" title={event.url}>
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
              <div className="mt-4 p-3 rounded bg-rose-50 border border-rose-200">
                <p className="text-sm text-rose-700 mb-1">
                  PHONE MATCHED: {matchedCall.phone_number}
                </p>
                <div className="flex items-center gap-4 text-sm text-muted-foreground tabular-nums">
                  <span>Score: {matchedCall.lead_score}</span>
                  <span suppressHydrationWarning>Match Time: {formatTimestamp(matchedCall.created_at)}</span>
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
                        className={`p-3 rounded border transition-colors ${session.id === sessionId
                          ? 'bg-emerald-50 border-emerald-200'
                          : 'bg-background border-border'
                          } hover:bg-muted/40`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
                                {formatTimestamp(session.created_at, {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {session.id === sessionId && (
                                <span className="text-sm px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                                  CURRENT
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {session.attribution_source && (
                                <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border">
                                  {session.attribution_source}
                                </span>
                              )}
                              {session.device_type && (
                                <span className="text-sm px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                  {session.device_type}
                                </span>
                              )}
                              {session.city && session.city !== 'Unknown' && (
                                <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border">
                                  {session.city}
                                </span>
                              )}
                              {session.lead_score !== null && session.lead_score !== undefined && (
                                <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                                  Score: {session.lead_score}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-muted-foreground tabular-nums">
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
                  <div className="mt-4 pt-4 border-t border-border">
                    <h4 className="text-sm font-semibold text-foreground mb-3">Other Calls (Same Fingerprint)</h4>
                    <div className="space-y-2">
                      {(visitorCalls || []).map((call) => (
                        <div
                          key={call.id}
                          className="p-3 rounded bg-muted/40 border border-border hover:bg-muted/60 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <span className="text-sm text-foreground tabular-nums">{call.phone_number}</span>
                                <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                                  Score: {call.lead_score}
                                </span>
                                {call.matched_session_id && (
                                  <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground border border-border tabular-nums">
                                    Matched to: {call.matched_session_id.slice(0, 8)}...
                                  </span>
                                )}
                              </div>
                              <span className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
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
              <div className="p-4 border-t border-border bg-muted/30">
                <p className="text-sm text-muted-foreground text-center tabular-nums">
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
