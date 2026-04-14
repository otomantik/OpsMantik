/**
 * PR4-C — Merge call-event sanitized click IDs + UTM from intent_page_url into classifier params.
 * Pure; mirrors process-call-event source signals + session-service param keys for determineTrafficSource.
 */

import { extractUTM } from '@/lib/attribution';
import { buildClassifierParamsForParity } from '@/lib/domain/deterministic-engine/parity-params';

export function buildClassifierParamsForCallEventParity(input: {
  /** Includes click_id fallback from worker (`sanitize(gclid) ?? sanitize(click_id)`). */
  sanitizedGclid: string | null;
  sanitizedWbraid: string | null;
  sanitizedGbraid: string | null;
  intentPageUrl: string | null;
}): Record<string, unknown> {
  const utm = input.intentPageUrl ? extractUTM(input.intentPageUrl) : null;
  const out = buildClassifierParamsForParity({
    sanitizedGclid: input.sanitizedGclid,
    utm,
  });
  if (input.sanitizedWbraid) {
    out.wbraid = input.sanitizedWbraid;
  }
  if (input.sanitizedGbraid) {
    out.gbraid = input.sanitizedGbraid;
  }
  return out;
}
