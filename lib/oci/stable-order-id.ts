/**
 * Stable Order ID — buildStableOrderId()
 *
 * Deterministic, idempotent orderId for Google Ads offline conversions.
 *
 * Key design decisions:
 * 1. valueCents is NOT in the hash. Value can change (RESTATEMENT), but the
 *    orderId must remain constant to match the original conversion in Google Ads.
 * 2. Namespace prefix (oci vs oct) prevents collision between standard OCI
 *    exports (GCLID-based) and Enhanced Conversions / OCT fallback exports.
 * 3. Date is date-only (YYYY-MM-DD), not timestamp. Two retry attempts on the
 *    same day produce the same orderId → Google deduplicates safely.
 * 4. Result is sliced to 64 chars (well within Google's 128-char limit).
 *    sha256 is 64 hex chars = no truncation needed.
 *
 * Adjustment guarantee:
 * When issuing a RETRACTION or RESTATEMENT, use the same inputs that produced
 * the original orderId. Because valueCents is excluded, the hash is stable
 * even after the value changes.
 */

import { createHash } from 'node:crypto';

export type ClickSource = 'gclid' | 'wbraid' | 'gbraid' | 'oct_phone' | 'oct_email' | 'no_id';

const MAX_ORDER_ID_LENGTH = 64;

/**
 * Build a stable, idempotent Google Ads orderId.
 *
 * @param clickSource - Attribution source (gclid/wbraid/gbraid/oct_phone/oct_email/no_id)
 * @param clickId     - The actual click identifier value
 * @param conversionActionName - Exact Google Ads conversion action name for this site
 * @param signalDate  - Date the conversion event occurred (time-of-day ignored)
 * @returns 64-char hex string (sha256)
 */
export function buildStableOrderId(
  clickSource: ClickSource,
  clickId: string,
  conversionActionName: string,
  signalDate: Date
): string {
  const dateYmd = signalDate.toISOString().slice(0, 10); // YYYY-MM-DD

  // Separate namespace for OCT (Enhanced Conversions / hashed identifier path)
  // vs standard OCI (click ID path). Prevents orderId collision if the same
  // phone number is both a click ID (hypothetical) and a hashed identifier.
  const ns: string = (clickSource === 'oct_phone' || clickSource === 'oct_email')
    ? 'oct'
    : 'oci';

  const raw = `${ns}|${clickId}|${conversionActionName}|${dateYmd}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, MAX_ORDER_ID_LENGTH);
}
