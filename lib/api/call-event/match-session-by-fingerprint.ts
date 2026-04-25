/**
 * Call-event session matching: find best session by fingerprint for a given site.
 * PR-OCI-7.4: 14-day lookback, GCLID-preferring ranking (never lose paid attribution).
 * All queries MUST be scoped by site_id to prevent cross-tenant matching.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeScoreV1_1, deriveCallStatus } from '@/lib/scoring/compute-score-v1_1';

/** Configurable lookback for fingerprint→session bridge. 14 days covers typical cookie expiry. */
export const BRIDGE_LOOKBACK_DAYS = 14;

export interface MatchSessionParams {
  siteId: string;
  fingerprint: string;
  recentMonths: string[];
  /** ISO timestamp: events/sessions created_at >= this (replaces thirtyMinutesAgo). */
  lookbackCutoff: string;
  /** ISO timestamp of call time; used for tie-break when multiple sessions have click IDs (prefer closest). */
  callTime?: string;
}

export interface MatchSessionResult {
  matchedSessionId: string | null;
  sessionMonth: string | null;
  leadScore: number;
  scoreBreakdown: Record<string, unknown> | null;
  callStatus: string | null;
  confidenceScore: number | null;
  consentScopes: string[] | null;
  /** PR2: for consent provenance shadow (optional). */
  consentAt: string | null;
  consentProvenance: unknown;
}

type SessionRow = {
  id: string;
  created_at: string;
  created_month: string;
  consent_scopes: unknown;
  consent_at?: string | null;
  consent_provenance?: unknown;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
};

function hasClickId(s: SessionRow): boolean {
  const g = s.gclid != null && String(s.gclid).trim() !== '';
  const w = s.wbraid != null && String(s.wbraid).trim() !== '';
  const b = s.gbraid != null && String(s.gbraid).trim() !== '';
  return g || w || b;
}

/**
 * Find the best session for the given site and fingerprint.
 * PR-OCI-7.4: Rank by GCLID presence first, then created_at. 14-day lookback.
 */
export async function findRecentSessionByFingerprint(
  client: SupabaseClient,
  params: MatchSessionParams
): Promise<MatchSessionResult> {
  const { siteId, fingerprint, recentMonths, lookbackCutoff } = params;

  const result: MatchSessionResult = {
    matchedSessionId: null,
    sessionMonth: null,
    leadScore: 0,
    scoreBreakdown: null,
    callStatus: null,
    confidenceScore: null,
    consentScopes: null,
    consentAt: null,
    consentProvenance: null,
  };
  const sessions: SessionRow[] = [];

  const { data: recentEvents, error: eventsError } = await client
    .from('events')
    .select('session_id, session_month, metadata, created_at')
    .eq('site_id', siteId)
    .eq('metadata->>fingerprint', fingerprint)
    .in('session_month', recentMonths)
    .gte('created_at', lookbackCutoff)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(50);

  if (eventsError || !recentEvents || recentEvents.length === 0) {
    // Fallback: when call-event arrives before the corresponding sync event is persisted,
    // direct session lookup by fingerprint prevents false consent-missing drops (204).
    const { data: fallbackSessions } = await client
      .from('sessions')
      .select('id, created_at, created_month, consent_scopes, consent_at, consent_provenance, gclid, wbraid, gbraid')
      .eq('site_id', siteId)
      .eq('fingerprint', fingerprint)
      .in('created_month', recentMonths)
      .gte('created_at', lookbackCutoff)
      .order('created_at', { ascending: false })
      .limit(25);
    if (Array.isArray(fallbackSessions) && fallbackSessions.length > 0) {
      sessions.push(...(fallbackSessions as SessionRow[]));
    } else {
      return result;
    }
  }

  const uniquePairs = new Map<string, string>();
  for (const e of recentEvents ?? []) {
    const key = `${e.session_id}::${e.session_month}`;
    if (!uniquePairs.has(key)) uniquePairs.set(key, e.session_month);
  }

  for (const [key, sessionMonth] of uniquePairs) {
    const sessionId = key.split('::')[0];
    const { data: sess, error } = await client
      .from('sessions')
      .select('id, created_at, created_month, consent_scopes, consent_at, consent_provenance, gclid, wbraid, gbraid')
      .eq('id', sessionId)
      .eq('site_id', siteId)
      .eq('created_month', sessionMonth)
      .maybeSingle();

    if (!error && sess) sessions.push(sess as SessionRow);
  }

  const callTimeMs = params.callTime ? new Date(params.callTime).getTime() : null;
  sessions.sort((a, b) => {
    const aHas = hasClickId(a) ? 1 : 0;
    const bHas = hasClickId(b) ? 1 : 0;
    if (bHas !== aHas) return bHas - aHas;
    if (callTimeMs != null && aHas && bHas) {
      const aDiff = Math.abs(new Date(a.created_at).getTime() - callTimeMs);
      const bDiff = Math.abs(new Date(b.created_at).getTime() - callTimeMs);
      if (aDiff !== bDiff) return aDiff - bDiff;
    }
    const createdDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (createdDiff !== 0) return createdDiff;
    return (b.id ?? '').localeCompare(a.id ?? '');
  });

  const session = sessions[0];
  if (!session) return result;

  const matchedSessionId = session.id;
  const sessionMonth = session.created_month;
  const matchedAt = new Date().toISOString();
  const matchTime = new Date(matchedAt).getTime();

  const scopes = (session.consent_scopes ?? []) as string[];
  result.consentScopes = scopes;
  result.consentAt = session.consent_at ?? null;
  result.consentProvenance = session.consent_provenance ?? null;
  result.matchedSessionId = matchedSessionId;
  result.sessionMonth = sessionMonth;

  const sessionCreatedAt = new Date(session.created_at).getTime();
  const elapsedSeconds = Math.max(0, (matchTime - sessionCreatedAt) / 1000);
  const hasClickIdVal = hasClickId(session);

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
    hasClickId: hasClickIdVal,
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
