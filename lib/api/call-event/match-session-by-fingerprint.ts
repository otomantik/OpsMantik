/**
 * Call-event session matching: find most recent session by fingerprint for a given site.
 * All queries MUST be scoped by site_id to prevent cross-tenant matching.
 * Used by /api/call-event/v2 (and testable with a mock client).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface MatchSessionParams {
  siteId: string;
  fingerprint: string;
  recentMonths: string[];
  thirtyMinutesAgo: string;
}

export interface MatchSessionResult {
  matchedSessionId: string | null;
  sessionMonth: string | null;
  leadScore: number;
  scoreBreakdown: Record<string, unknown> | null;
  callStatus: string | null;
  /** Consent scopes from session (for analytics gate). Indexed: sessions(site_id, id, created_month). */
  consentScopes: string[] | null;
}

/**
 * Find the most recent session for the given site and fingerprint.
 * REQUIRED: siteId is applied at SQL level to every query (no cross-tenant data).
 */
export async function findRecentSessionByFingerprint(
  client: SupabaseClient,
  params: MatchSessionParams
): Promise<MatchSessionResult> {
  const { siteId, fingerprint, recentMonths, thirtyMinutesAgo } = params;

  const result: MatchSessionResult = {
    matchedSessionId: null,
    sessionMonth: null,
    leadScore: 0,
    scoreBreakdown: null,
    callStatus: null,
    consentScopes: null,
  };

  const { data: recentEvents, error: eventsError } = await client
    .from('events')
    .select('session_id, session_month, metadata, created_at')
    .eq('site_id', siteId)
    .eq('metadata->>fingerprint', fingerprint)
    .in('session_month', recentMonths)
    .gte('created_at', thirtyMinutesAgo)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);

  if (eventsError || !recentEvents || recentEvents.length === 0) {
    return result;
  }

  const matchedSessionId = recentEvents[0].session_id;
  const sessionMonth = recentEvents[0].session_month;
  const matchedAt = new Date().toISOString();

  const { data: session, error: sessionError } = await client
    .from('sessions')
    .select('id, created_at, created_month, consent_scopes')
    .eq('id', matchedSessionId)
    .eq('site_id', siteId)
    .eq('created_month', sessionMonth)
    .single();

  if (sessionError || !session) {
    return result;
  }

  const scopes = (session.consent_scopes ?? []) as string[];
  result.consentScopes = scopes;

  const sessionCreatedAt = new Date(session.created_at);
  const matchTime = new Date(matchedAt);
  const timeDiffMinutes = (sessionCreatedAt.getTime() - matchTime.getTime()) / (1000 * 60);
  result.callStatus = timeDiffMinutes > 2 ? 'suspicious' : 'intent';
  result.matchedSessionId = matchedSessionId;
  result.sessionMonth = sessionMonth;

  const { data: sessionEvents, error: sessionEventsError } = await client
    .from('events')
    .select('event_category, event_action, metadata')
    .eq('site_id', siteId)
    .eq('session_id', matchedSessionId)
    .eq('session_month', sessionMonth);

  if (sessionEventsError || !sessionEvents || sessionEvents.length === 0) {
    return result;
  }

  const conversionCount = sessionEvents.filter((e) => e.event_category === 'conversion').length;
  const interactionCount = sessionEvents.filter((e) => e.event_category === 'interaction').length;
  const scores = sessionEvents.map((e) => Number((e.metadata as { lead_score?: number })?.lead_score) || 0);
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const conversionPoints = conversionCount * 20;
  const interactionPoints = interactionCount * 5;
  const rawScore = conversionPoints + interactionPoints + maxScore;
  result.leadScore = Math.min(rawScore, 100);
  result.scoreBreakdown = {
    conversionPoints,
    interactionPoints,
    bonuses: maxScore,
    cappedAt100: rawScore > 100,
    rawScore,
    finalScore: result.leadScore,
  };

  return result;
}
