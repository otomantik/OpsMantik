/**
 * Best-effort primary_source extraction from call or session (gclid, wbraid, gbraid, utm_*).
 * Tenant-safe: all reads filtered by site_id. Returns null on any error or uncertain partition resolution.
 * OCI-9E: Bounded retry (2 retries, 50–150ms jitter) for replica lag; Sentry on final failure.
 *
 * Attribution precedence (for fan-out from conversation_links): Call > Session > Event.
 * Call is treated as higher intent; when resolving GCLID from multiple linked entities, prefer the call's
 * matched session over a standalone session link.
 */

import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import * as Sentry from '@sentry/nextjs';

export interface PrimarySourceInput {
  callId?: string;
  sessionId?: string;
}

export type PrimarySource = {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  referrer?: string | null;
};

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS_MIN = 50;
const RETRY_DELAY_MS_MAX = 150;

function jitterMs(): number {
  return RETRY_DELAY_MS_MIN + Math.floor(Math.random() * (RETRY_DELAY_MS_MAX - RETRY_DELAY_MS_MIN + 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch primary_source jsonb for conversation. Best-effort; returns null if session/call not found or any error.
 * OCI-9E: Retries up to 3 times with jitter to mitigate replica lag; logs and Sentry on final failure.
 * Precedence: when both callId and sessionId could apply, call is used first (higher intent).
 */
export async function getPrimarySource(
  siteId: string,
  input: PrimarySourceInput
): Promise<PrimarySource | null> {
  if (input.callId) {
    let lastError: unknown = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const { data: rows, error } = await adminClient.rpc('get_call_session_for_oci', {
        p_call_id: input.callId,
        p_site_id: siteId,
      });
      if (error) {
        lastError = error;
        if (attempt < RETRY_ATTEMPTS - 1) await sleep(jitterMs());
        continue;
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        lastError = new Error('PRIMARY_SOURCE_NOT_FOUND');
        if (attempt < RETRY_ATTEMPTS - 1) await sleep(jitterMs());
        continue;
      }
      const row = rows[0] as {
        gclid?: string | null;
        wbraid?: string | null;
        gbraid?: string | null;
        utm_source?: string | null;
        utm_medium?: string | null;
        utm_campaign?: string | null;
        utm_content?: string | null;
        utm_term?: string | null;
        referrer_host?: string | null;
      };
      return {
        gclid: row.gclid ?? null,
        wbraid: row.wbraid ?? null,
        gbraid: row.gbraid ?? null,
        utm_source: row.utm_source ?? null,
        utm_medium: row.utm_medium ?? null,
        utm_campaign: row.utm_campaign ?? null,
        utm_content: row.utm_content ?? null,
        utm_term: row.utm_term ?? null,
        referrer: row.referrer_host ?? null,
      };
    } catch (e) {
      lastError = e;
      if (attempt < RETRY_ATTEMPTS - 1) await sleep(jitterMs());
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  logWarn('getPrimarySource returned null', {
    callId: input.callId,
    siteId,
    reason: 'PRIMARY_SOURCE_NOT_FOUND',
    attempts: RETRY_ATTEMPTS,
    lastError: msg,
  });
  Sentry.captureMessage('getPrimarySource returned null', {
    level: 'warning',
    extra: { callId: input.callId, siteId, reason: 'PRIMARY_SOURCE_NOT_FOUND', lastError: msg },
  });
  return null;
  }
  if (input.sessionId) {
    return getPrimarySourceFromSession(siteId, input.sessionId);
  }
  return null;
}

/**
 * P0-1.3: Batch fetch primary sources for multiple call_ids in 2 queries instead of N.
 * Returns Map<callId, PrimarySource | null>. Missing or errored calls map to null.
 */
export async function getPrimarySourceBatch(
  siteId: string,
  callIds: string[]
): Promise<Map<string, PrimarySource | null>> {
  const result = new Map<string, PrimarySource | null>();
  if (callIds.length === 0) return result;

  const uniqueCallIds = [...new Set(callIds)];
  try {
    const { data: callsData, error: callsError } = await adminClient
      .from('calls')
      .select('id, matched_session_id')
      .eq('site_id', siteId)
      .in('id', uniqueCallIds);

    if (callsError || !callsData?.length) {
      uniqueCallIds.forEach((id) => result.set(id, null));
      return result;
    }

    const sessionIds = [...new Set(
      callsData
        .map((c: { matched_session_id?: string | null }) => c.matched_session_id)
        .filter((s): s is string => Boolean(s))
    )];

    if (sessionIds.length === 0) {
      callsData.forEach((c: { id: string }) => result.set(c.id, null));
      uniqueCallIds.filter((id) => !result.has(id)).forEach((id) => result.set(id, null));
      return result;
    }

    const { data: sessionsData, error: sessionsError } = await adminClient
      .from('sessions')
      .select('id, gclid, wbraid, gbraid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer_host')
      .eq('site_id', siteId)
      .in('id', sessionIds);

    const sessionById = new Map<string, PrimarySource>();
    if (!sessionsError && sessionsData) {
      for (const s of sessionsData) {
        const id = (s as { id: string }).id;
        sessionById.set(id, {
          gclid: (s as { gclid?: string | null }).gclid ?? null,
          wbraid: (s as { wbraid?: string | null }).wbraid ?? null,
          gbraid: (s as { gbraid?: string | null }).gbraid ?? null,
          utm_source: (s as { utm_source?: string | null }).utm_source ?? null,
          utm_medium: (s as { utm_medium?: string | null }).utm_medium ?? null,
          utm_campaign: (s as { utm_campaign?: string | null }).utm_campaign ?? null,
          utm_content: (s as { utm_content?: string | null }).utm_content ?? null,
          utm_term: (s as { utm_term?: string | null }).utm_term ?? null,
          referrer: (s as { referrer_host?: string | null }).referrer_host ?? null,
        });
      }
    }

    const callToSession = new Map(
      callsData.map((c: { id: string; matched_session_id?: string | null }) => [c.id, c.matched_session_id])
    );
    for (const callId of uniqueCallIds) {
      const sessionId = callToSession.get(callId);
      result.set(callId, sessionId ? sessionById.get(sessionId) ?? null : null);
    }
    return result;
  } catch {
    uniqueCallIds.forEach((id) => result.set(id, null));
    return result;
  }
}

async function getPrimarySourceFromSession(
  siteId: string,
  sessionId: string
): Promise<PrimarySource | null> {
  try {
    const { data: session, error } = await adminClient
      .from('sessions')
      .select('gclid, wbraid, gbraid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer_host')
      .eq('id', sessionId)
      .eq('site_id', siteId)
      .limit(1)
      .maybeSingle();

    if (error || !session) return null;

    return {
      gclid: session.gclid ?? null,
      wbraid: session.wbraid ?? null,
      gbraid: session.gbraid ?? null,
      utm_source: session.utm_source ?? null,
      utm_medium: session.utm_medium ?? null,
      utm_campaign: session.utm_campaign ?? null,
      utm_content: session.utm_content ?? null,
      utm_term: session.utm_term ?? null,
      referrer: (session as { referrer_host?: string }).referrer_host ?? null,
    };
  } catch {
    return null;
  }
}
