/**
 * Best-effort primary_source extraction from call or session (gclid, wbraid, gbraid, utm_*).
 * Tenant-safe: all reads filtered by site_id. Returns null on any error or uncertain partition resolution.
 *
 * Attribution precedence (for fan-out from conversation_links): Call > Session > Event.
 * Call is treated as higher intent; when resolving GCLID from multiple linked entities, prefer the call's
 * matched session over a standalone session link.
 */

import { adminClient } from '@/lib/supabase/admin';

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

/**
 * Fetch primary_source jsonb for conversation. Best-effort; returns null if session/call not found or any error.
 * Always scopes reads by site_id for tenant safety.
 * Precedence: when both callId and sessionId could apply, call is used first (higher intent).
 */
export async function getPrimarySource(
  siteId: string,
  input: PrimarySourceInput
): Promise<PrimarySource | null> {
  try {
    if (input.callId) {
      const { data: rows, error } = await adminClient.rpc('get_call_session_for_oci', {
        p_call_id: input.callId,
        p_site_id: siteId,
      });
      if (error || !Array.isArray(rows) || rows.length === 0) return null;
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
    }
    if (input.sessionId) {
      return getPrimarySourceFromSession(siteId, input.sessionId);
    }
    return null;
  } catch {
    return null;
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
