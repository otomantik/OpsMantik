/**
 * Identity Stitcher — Multi-stage GCLID recovery (MODULE 1)
 *
 * When direct session has no GCLID, recover from cross-session identity.
 * Order: DIRECT → PHONE_STITCH → FINGERPRINT_STITCH
 *
 * Red lines:
 * - Only recovers click_id; never changes attribution_source or session_id
 * - PHONE_STITCH: only from confirmed/sealed calls, session_created_at <= call_time, max 30d
 * - discovery_confidence (0-1) required for stitched methods
 */

import { adminClient } from '@/lib/supabase/admin';
import type { PrimarySource } from '@/lib/conversation/primary-source';

export type DiscoveryMethod = 'DIRECT' | 'PHONE_STITCH' | 'FINGERPRINT_STITCH';

export interface PrimarySourceWithDiscovery {
  source: PrimarySource;
  discoveryMethod: DiscoveryMethod;
  discoveryConfidence: number;
}

const PHONE_STITCH_WINDOW_DAYS = 30;
const FINGERPRINT_STITCH_WINDOW_DAYS = 14;
/** Source call statuses for PHONE_STITCH (confirmed/sealed calls only) */
const PHONE_SOURCE_STATUSES = ['confirmed', 'qualified', 'real'] as const;

/**
 * Attempt PHONE_STITCH: find GCLID from other calls with same caller_phone_e164.
 * Safeguards: source calls confirmed/sealed, session_created_at <= call_time, max 30d.
 */
async function tryPhoneStitch(
  siteId: string,
  callId: string,
  callerPhoneE164: string,
  callTime: string
): Promise<{ gclid: string | null; wbraid: string | null; gbraid: string | null; confidence: number } | null> {
  const since = new Date(Date.now() - PHONE_STITCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: otherCalls } = await adminClient
    .from('calls')
    .select('id, matched_session_id, confirmed_at, created_at')
    .eq('site_id', siteId)
    .eq('caller_phone_e164', callerPhoneE164)
    .neq('id', callId)
    .in('status', PHONE_SOURCE_STATUSES)
    .gte('created_at', since)
    .limit(20);

  if (!otherCalls?.length) return null;

  const sessionIds = [...new Set(
    otherCalls
      .map((c: { matched_session_id?: string | null }) => c.matched_session_id)
      .filter((s): s is string => Boolean(s))
  )];
  if (sessionIds.length === 0) return null;

  const { data: sessions } = await adminClient
    .from('sessions')
    .select('id, created_at, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .in('id', sessionIds);

  if (!sessions?.length) return null;

  const callTimeMs = new Date(callTime).getTime();
  const candidates: { gclid: string; wbraid: string; gbraid: string }[] = [];

  for (const s of sessions) {
    const sessionCreated = new Date(s.created_at).getTime();
    if (sessionCreated > callTimeMs) continue; // session must exist when call occurred

    const gclid = (s.gclid ?? '').trim();
    const wbraid = (s.wbraid ?? '').trim();
    const gbraid = (s.gbraid ?? '').trim();
    const clickId = gclid || wbraid || gbraid;
    if (clickId) {
      candidates.push({
        gclid: gclid || '',
        wbraid: wbraid || '',
        gbraid: gbraid || '',
      });
    }
  }

  if (candidates.length === 0) return null;

  // Single match = 0.8; multiple = 0.6 (plan: "0.8 single match, 0.6 multiple candidates")
  const confidence = candidates.length === 1 ? 0.8 : 0.6;
  const first = candidates[0];
  return {
    gclid: first.gclid || null,
    wbraid: first.wbraid || null,
    gbraid: first.gbraid || null,
    confidence,
  };
}

/**
 * Attempt FINGERPRINT_STITCH: find GCLID from sessions with same fingerprint.
 * Window: 14 days.
 */
async function tryFingerprintStitch(
  siteId: string,
  fingerprint: string,
  callTime: string
): Promise<{ gclid: string | null; wbraid: string | null; gbraid: string | null; confidence: number } | null> {
  const since = new Date(Date.now() - FINGERPRINT_STITCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const callTimeMs = new Date(callTime).getTime();

  const { data: sessions } = await adminClient
    .from('sessions')
    .select('id, created_at, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .eq('fingerprint', fingerprint)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!sessions?.length) return null;

  for (const s of sessions) {
    const sessionCreated = new Date(s.created_at).getTime();
    if (sessionCreated > callTimeMs) continue;

    const gclid = (s.gclid ?? '').trim();
    const wbraid = (s.wbraid ?? '').trim();
    const gbraid = (s.gbraid ?? '').trim();
    const clickId = gclid || wbraid || gbraid;
    if (clickId) {
      return {
        gclid: gclid || null,
        wbraid: wbraid || null,
        gbraid: gbraid || null,
        confidence: 0.7, // fingerprint stitch
      };
    }
  }
  return null;
}

/**
 * Get primary source with multi-stage Identity Stitcher.
 * Returns discovery_method and discovery_confidence for audit.
 */
export async function getPrimarySourceWithDiscovery(
  siteId: string,
  directSource: PrimarySource | null,
  context: { callId: string; callTime: string; callerPhoneE164?: string | null; fingerprint?: string | null }
): Promise<PrimarySourceWithDiscovery | null> {
  const clickId = (directSource?.gclid || directSource?.wbraid || directSource?.gbraid || '').trim();
  if (directSource && clickId) {
    return {
      source: directSource,
      discoveryMethod: 'DIRECT',
      discoveryConfidence: 1.0,
    };
  }

  // PHONE_STITCH (only if we have caller_phone)
  const phone = (context.callerPhoneE164 ?? '').trim();
  if (phone) {
    const phoneResult = await tryPhoneStitch(
      siteId,
      context.callId,
      phone,
      context.callTime
    );
    if (phoneResult && (phoneResult.gclid || phoneResult.wbraid || phoneResult.gbraid)) {
      return {
        source: {
          gclid: phoneResult.gclid,
          wbraid: phoneResult.wbraid,
          gbraid: phoneResult.gbraid,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
          utm_content: null,
          utm_term: null,
          referrer: null,
        },
        discoveryMethod: 'PHONE_STITCH',
        discoveryConfidence: phoneResult.confidence,
      };
    }
  }

  // FINGERPRINT_STITCH
  const fp = (context.fingerprint ?? '').trim();
  if (fp) {
    const fpResult = await tryFingerprintStitch(siteId, fp, context.callTime);
    if (fpResult && (fpResult.gclid || fpResult.wbraid || fpResult.gbraid)) {
      return {
        source: {
          gclid: fpResult.gclid,
          wbraid: fpResult.wbraid,
          gbraid: fpResult.gbraid,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
          utm_content: null,
          utm_term: null,
          referrer: null,
        },
        discoveryMethod: 'FINGERPRINT_STITCH',
        discoveryConfidence: fpResult.confidence,
      };
    }
  }

  return directSource ? { source: directSource, discoveryMethod: 'DIRECT', discoveryConfidence: 1.0 } : null;
}
