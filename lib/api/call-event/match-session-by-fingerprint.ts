/**
 * Call-event session matching: find most recent session by fingerprint for a given site.
 * All queries MUST be scoped by site_id to prevent cross-tenant matching.
 * Used by /api/call-event/v2 and /api/call-event (legacy). Scoring: V1.1 (bonus cap + confidence).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeScoreV1_1, deriveCallStatus } from '@/lib/scoring/compute-score-v1_1';

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
  /** V1.1: linear confidence 0–100 */
  confidenceScore: number | null;
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
    confidenceScore: null,
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
  const matchTime = new Date(matchedAt).getTime();

  const { data: session, error: sessionError } = await client
    .from('sessions')
    .select('id, created_at, created_month, consent_scopes, gclid, wbraid, gbraid')
    .eq('id', matchedSessionId)
    .eq('site_id', siteId)
    .eq('created_month', sessionMonth)
    .single();

  if (sessionError || !session) {
    return result;
  }

  const scopes = (session.consent_scopes ?? []) as string[];
  result.consentScopes = scopes;
  result.matchedSessionId = matchedSessionId;
  result.sessionMonth = sessionMonth;

  const sessionCreatedAt = new Date(session.created_at).getTime();
  const elapsedSeconds = Math.max(0, (matchTime - sessionCreatedAt) / 1000);

  const gclid = (session as { gclid?: string | null }).gclid;
  const wbraid = (session as { wbraid?: string | null }).wbraid;
  const gbraid = (session as { gbraid?: string | null }).gbraid;
  const hasClickId = Boolean(
    (gclid && String(gclid).trim() !== '') ||
      (wbraid && String(wbraid).trim() !== '') ||
      (gbraid && String(gbraid).trim() !== '')
  );

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
  const bonusFromEvents = scores.length > 0 ? Math.max(...scores) : 0;
  const eventCount = sessionEvents.length;

  const output = computeScoreV1_1({
    conversionCount,
    interactionCount,
    bonusFromEvents,
    hasClickId,
    elapsedSeconds,
    eventCount,
  });

  result.leadScore = output.finalScore;
  result.confidenceScore = output.confidenceScore;
  result.callStatus = deriveCallStatus(output);
  result.scoreBreakdown = {
    ...output,
    conversionPoints: output.conversionPoints,
    interactionPoints: output.interactionPoints,
    bonuses: output.bonuses,
    bonusesCapped: output.bonusesCapped,
    cappedAt100: output.cappedAt100,
    rawScore: output.rawScore,
    finalScore: output.finalScore,
    confidenceScore: output.confidenceScore,
    elapsedSeconds: output.elapsedSeconds,
    inputsSnapshot: output.inputsSnapshot,
  } as Record<string, unknown>;

  return result;
}
