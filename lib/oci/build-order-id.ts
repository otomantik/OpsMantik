/**
 * Extinction Patch 4.1: Deterministic Order ID with unique suffix.
 * Same row -> same orderId (idempotent retries). Different rows same second -> different orderIds.
 * Google Ads 128-character limit enforced via .slice(0, 128).
 */

import crypto from 'crypto';

const MAX_ORDER_ID_LENGTH = 128;

/**
 * Deterministic hash suffix from row identity. Same inputs -> same hash.
 */
function deterministicSuffix(clickId: string, conversionTime: string, rowId: string, valueCents: number): string {
  const input = `${clickId}|${conversionTime}|${rowId}|${valueCents}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
}

/**
 * Build a deterministic, collision-resistant order ID for Google Ads offline conversions.
 *
 * @param prefix - Conversion tag (e.g. 'V5_SEAL' or 'OpsMantik_V5_DEMIR_MUHUR')
 * @param clickId - gclid/wbraid/gbraid (empty string = no click)
 * @param conversionTime - Canonical conversion time string (same format for same row across paths)
 * @param fallbackId - Used when no clickId (e.g. 'seal_<rowId>')
 * @param rowId - Queue row id for uniqueness
 * @param valueCents - Optional; included in hash for extra entropy
 */
export function buildOrderId(
  prefix: string,
  clickId: string | null,
  conversionTime: string,
  fallbackId: string,
  rowId: string,
  valueCents: number = 0
): string {
  const sanitized = conversionTime.replace(/[:.]/g, '-');
  if (!clickId) return fallbackId.slice(0, MAX_ORDER_ID_LENGTH);
  const suffix = deterministicSuffix(clickId, conversionTime, rowId, valueCents);
  const raw = `${clickId}_${prefix}_${sanitized}_${suffix}`;
  return raw.slice(0, MAX_ORDER_ID_LENGTH);
}
