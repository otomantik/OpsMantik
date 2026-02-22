'use client';

import React, { useState, useEffect, memo, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { useVisitorHistory } from '@/lib/hooks/use-visitor-history';
import { debugLog } from '@/lib/utils'; // Assuming formatTimestamp is used via props or updated import
import { logger } from '@/lib/logging/logger';
import { SessionCardHeader } from './session-group/session-card-header';
import { SessionCardExpanded, type CompressedEvent, type EnrichedEvent } from './session-group/session-card-expanded';
import { VisitorHistoryDrawer } from './session-group/visitor-history-drawer';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface Event {
  id: string;
  event_category: string;
  event_action: string;
  event_label: string | null;
  event_value: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  url?: string;
  timeDiff?: number; // Added for compatibility with sub-components
}

interface SessionGroupProps {
  siteId?: string;
  sessionId: string;
  events: Event[];
  adsOnly?: boolean;
}

export const SessionGroup = memo(function SessionGroup({ siteId, sessionId, events, adsOnly = false }: SessionGroupProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showVisitorHistory, setShowVisitorHistory] = useState(false);
  const [matchedCall, setMatchedCall] = useState<{ id: string; phone_number?: string; matched_session_id?: string | null; lead_score?: number | null; created_at?: string } | null>(null);
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

  // Fetch session data
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
        setIsExcludedByAdsOnly(true);
      }
      setAdsGateChecked(true);
    };

    fetchSessionData();
  }, [siteId, sessionId, adsOnly]);

  const attributionSource = (sessionData?.attribution_source ?? metadata.attribution_source ?? null) as string | null;
  const intelligenceSummary = (typeof metadata.intelligence_summary === 'string' ? metadata.intelligence_summary : t('intelligence.standardTraffic'));
  const gclid = (sessionData?.gclid ?? metadata.gclid ?? null) as string | null;

  const fingerprint = (sessionData?.fingerprint ?? metadata.fingerprint ?? metadata.fp ?? null) as string | null;
  const effectiveSiteId = (sessionData?.site_id ?? siteId) ?? null;

  const { sessions: visitorSessions, calls: visitorCalls, sessionCount24h, isReturning, isLoading: isLoadingHistory } = useVisitorHistory(
    effectiveSiteId || '',
    fingerprint
  );

  const city = (sessionData?.city ?? metadata.city ?? null) as string | null;
  const district = (sessionData?.district ?? metadata.district ?? null) as string | null;
  const device = (sessionData?.device_type ?? metadata.device_type ?? null) as string | null;
  const os = (metadata.os ?? null) as string | null;
  const browser = (metadata.browser ?? null) as string | null;

  useEffect(() => {
    if (!sessionId) return;
    const supabase = createClient();
    const siteIdForQuery = sessionData?.site_id;
    if (!siteIdForQuery) return;

    supabase
      .from('calls')
      .select('*, sites!inner(user_id)')
      .eq('matched_session_id', sessionId)
      .eq('site_id', siteIdForQuery)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) {
          setMatchedCall(data);
        }
      });
  }, [sessionId, sessionData]);

  // Event compression logic
  const compressedEvents = useMemo(() => {
    const COMPRESSION_WINDOW_MS = 2000;
    const sorted = [...events].sort((a, b) => {
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    const eventsWithTimeDiff: Event[] = sorted.map((event, index) => {
      const timeDiff =
        index > 0
          ? Math.round((new Date(event.created_at).getTime() - new Date(sorted[index - 1].created_at).getTime()) / 1000)
          : 0;
      return { ...event, timeDiff };
    });

    const result: CompressedEvent[] = [];
    if (eventsWithTimeDiff.length === 0) return result;

    const getPrevTime = (last: CompressedEvent): string => last.lastTime ?? (last.type === 'single' && last.event ? last.event.created_at : '');

    let i = 0;
    while (i < eventsWithTimeDiff.length) {
      const currentEvent = eventsWithTimeDiff[i];
      const currentTime = new Date(currentEvent.created_at).getTime();
      const group = [currentEvent];
      let j = i + 1;

      while (j < eventsWithTimeDiff.length) {
        const nextEvent = eventsWithTimeDiff[j];
        const nextTime = new Date(nextEvent.created_at).getTime();
        const timeDiff = nextTime - currentTime;

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

      if (group.length > 1) {
        const groupKey = `group-${currentEvent.id}-${group[group.length - 1].id}`;
        result.push({
          type: 'group' as const,
          id: groupKey,
          events: group as EnrichedEvent[],
          count: group.length,
          firstTime: group[0].created_at,
          lastTime: group[group.length - 1].created_at,
          timeDiff:
            result.length > 0
              ? Math.round(
                (new Date(group[0].created_at).getTime() - new Date(getPrevTime(result[result.length - 1])).getTime()) /
                1000
              )
              : 0,
        });
      } else {
        result.push({
          type: 'single' as const,
          id: currentEvent.id,
          event: currentEvent as EnrichedEvent,
          firstTime: currentEvent.created_at,
          lastTime: currentEvent.created_at,
          timeDiff:
            result.length > 0
              ? Math.round(
                (new Date(currentEvent.created_at).getTime() - new Date(getPrevTime(result[result.length - 1])).getTime()) /
                1000
              )
              : 0,
        });
      }
      i = j;
    }
    return result;
  }, [events]);

  if (adsOnly && !adsGateChecked) return null;
  if (adsOnly && isExcludedByAdsOnly) return null;

  const getBorderColor = (score: number) => {
    if (score >= 71) return 'border-amber-300';
    if (score >= 31) return 'border-blue-200';
    return 'border-border';
  };

  const sortedEvents = [...events].sort((a, b) => {
    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });

  const sessionDuration = sortedEvents.length > 1
    ? Math.round((new Date(lastEvent.created_at).getTime() - new Date(firstEvent.created_at).getTime()) / 1000)
    : 0;

  const conversionCount = events.filter(e => e.event_category === 'conversion').length;
  const hasPhoneCall = events.some(e =>
    e.event_action?.toLowerCase().includes('phone') ||
    e.event_action?.toLowerCase().includes('call')
  );



  const handleCopyFingerprint = async (e: React.MouseEvent, fullFingerprint: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(fullFingerprint);
    } catch (err) {
      logger.error('SESSION_GROUP failed to copy fingerprint', { error: String((err as Error)?.message ?? err) });
    }
  };

  const handleToggleVisitorHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
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
      data-session-id={sessionId}
    >
      <CardContent className="p-0">
        <SessionCardHeader
          session={{
            id: sessionId,
            first_event_created_at: firstEvent.created_at,
            duration: sessionDuration,
            events_count: events.length,
            conversion_count: conversionCount,
            has_phone_call: hasPhoneCall,
            matched_call_number: matchedCall?.phone_number ?? null,
            lead_score: leadScore,
            intelligence_summary: intelligenceSummary,
            attribution_source: attributionSource,
            gclid: gclid,
            fingerprint: fingerprint,
            is_returning: isReturning,
            session_count_24h: sessionCount24h,
            site_id: siteId,
            city: city,
            district: district,
            device_type: device,
            os: os,
            browser: browser,
          }}
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded(!isExpanded)}
          onCopyFingerprint={handleCopyFingerprint}
          onHistoryClick={handleToggleVisitorHistory}
        />

        {isExpanded && (
          <SessionCardExpanded
            events={events}
            sortedEvents={sortedEvents}
            compressedEvents={compressedEvents}
            expandedGroups={expandedGroups}
            onToggleGroup={toggleGroup}
            matchedCall={matchedCall}
          />
        )}
      </CardContent>

      {showVisitorHistory && fingerprint && siteId && (
        <VisitorHistoryDrawer
          fingerprint={fingerprint}
          siteId={siteId}
          visitorSessions={visitorSessions}
          visitorCalls={visitorCalls}
          sessionCount24h={sessionCount24h}
          isLoading={isLoadingHistory}
          onClose={() => setShowVisitorHistory(false)}
          currentSessionId={sessionId}
        />
      )}
    </Card>
  );
}, (prevProps, nextProps) => {
  return prevProps.sessionId === nextProps.sessionId &&
    prevProps.events === nextProps.events;
});
