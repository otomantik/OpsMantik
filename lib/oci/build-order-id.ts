/**
 * Extinction Patch 4.1: Deterministic Order ID with unique suffix.
 * Same row -> same orderId (idempotent retries). Different rows same second -> different orderIds.
 * Google Ads 128-character limit enforced via .slice(0, 128).
 */

import crypto from 'crypto';

const MAX_ORDER_ID_LENGTH = 128;

/**
 * Deterministic hash suffix from row identity.
 * If rowId is a call UUID, the ID remains stable across signal updates.
 */
function deterministicSuffix(clickId: string, conversionTime: string, identity: string, valueCents: number): string {
  const input = `${clickId}|${conversionTime}|${identity}|${valueCents}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
}

/**
 * Build a deterministic, collision-resistant order ID for Google Ads offline conversions.
 *
 * @param prefix - Conversion tag (e.g. 'OpsMantik_Won')
 * @param clickId - gclid/wbraid/gbraid
 * @param conversionTime - Canonical conversion time string
 * @param fallbackId - Used when no clickId
 * @param identity - Stable identity (typically callId for OpsMantik, or rowId for diagnostics)
 * @param valueCents - Included in hash for extra entropy
 */
export function buildOrderId(
  prefix: string,
  clickId: string | null,
  conversionTime: string,
  fallbackId: string,
  identity: string,
  valueCents: number = 0
): string {
  if (!clickId) return fallbackId.slice(0, MAX_ORDER_ID_LENGTH);
  const suffix = deterministicSuffix(clickId, conversionTime, identity, valueCents);
  const raw = `${identity}_${prefix}_${suffix}`; // Simplified for maximum stability across retatements
  return raw.slice(0, MAX_ORDER_ID_LENGTH);
}
