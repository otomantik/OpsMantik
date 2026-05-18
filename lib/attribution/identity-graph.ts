/**
 * Phase 1 — Privacy-safe identity graph (gated by SHADOW_ID_STITCHING_ENABLED).
 */

import { createHmac, createHash } from 'node:crypto';
import { sanitizeClickId } from '@/lib/attribution';
import type { TrafficChannel } from './truth-engine-types';

const STITCH_WINDOW_MS = 72 * 60 * 60 * 1000;
const UA_SIMILARITY_THRESHOLD = 0.85;

export type ShadowSessionRecord = {
  shadow_id_digest: string;
  session_id: string;
  created_at: number;
  device_type?: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  channel?: TrafficChannel | null;
  user_agent?: string | null;
  ip_subnet?: string | null;
};

export type StitchResult = {
  matched: boolean;
  inherited_click_ids?: { gclid?: string; wbraid?: string; gbraid?: string };
  trace_message?: string;
  matched_session_id?: string;
};

function normalizeUa(ua: string): string {
  return ua.trim().toLowerCase();
}

function uaTokenSet(ua: string): Set<string> {
  return new Set(
    normalizeUa(ua)
      .split(/[\s/;,()]+/)
      .filter((t) => t.length > 1)
  );
}

export function uaJaccardSimilarity(a: string, b: string): number {
  const sa = uaTokenSet(a);
  const sb = uaTokenSet(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter++;
  }
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function ipv4Subnet(ip: string): string | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

export function generateShadowId(
  ip: string,
  userAgent: string,
  acceptLanguage: string,
  timezoneOffset: number
): string {
  const subnet = ipv4Subnet(ip) ?? 'unknown';
  const payload = `${subnet}|${normalizeUa(userAgent)}|${acceptLanguage.trim().toLowerCase()}|${timezoneOffset}`;
  const pepper = process.env.IDENTITY_SHADOW_PEPPER?.trim();
  if (pepper) {
    return createHmac('sha256', pepper).update(payload, 'utf8').digest('hex');
  }
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function extractSanitizedIds(row: ShadowSessionRecord): StitchResult['inherited_click_ids'] {
  const gclid = sanitizeClickId(row.gclid);
  const wbraid = sanitizeClickId(row.wbraid);
  const gbraid = sanitizeClickId(row.gbraid);
  if (!gclid && !wbraid && !gbraid) return undefined;
  return { gclid, wbraid, gbraid };
}

/**
 * Pure stitch against in-memory candidate rows (DB loader supplies candidates).
 */
export function stitchSessions(
  currentSession: {
    shadowId: string;
    userAgent: string;
    ip_subnet?: string | null;
    hasLandingClickId: boolean;
  },
  candidates: ShadowSessionRecord[],
  nowMs: number = Date.now()
): StitchResult {
  if (currentSession.hasLandingClickId) {
    return { matched: false };
  }

  const recent = candidates.filter((c) => nowMs - c.created_at <= STITCH_WINDOW_MS);

  const byShadow = recent.find((c) => c.shadow_id_digest === currentSession.shadowId);
  let match = byShadow ?? null;

  if (!match && currentSession.ip_subnet) {
    match =
      recent.find((c) => {
        if (c.ip_subnet !== currentSession.ip_subnet) return false;
        const uaA = c.user_agent ?? '';
        const uaB = currentSession.userAgent;
        return uaJaccardSimilarity(uaA, uaB) >= UA_SIMILARITY_THRESHOLD;
      }) ?? null;
  }

  if (!match) return { matched: false };

  const inherited = extractSanitizedIds(match);
  if (!inherited) return { matched: false };

  return {
    matched: true,
    inherited_click_ids: inherited,
    matched_session_id: match.session_id,
    trace_message: 'IDENTITY_GRAPH: Cross-device stitched via Shadow ID',
  };
}
