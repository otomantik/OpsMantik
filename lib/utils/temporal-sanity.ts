/**
 * Axiom 2: Temporal Sanity Window
 * Reference: Causal Integrity Report — Chronological Entropy
 *
 * Reject/quarantine timestamps outside [now - 90 days, now + 1 hour].
 * Prevents "Temporal Poisoning" and ROAS drift from clock smear / future timestamps.
 */

const MAX_PAST_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const MAX_FUTURE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Returns true if the timestamp is within [now - 90 days, now + 1 hour].
 * Invalid dates (NaN) return false.
 */
export function isWithinTemporalSanityWindow(ts: Date | string | number | null | undefined): boolean {
  if (ts == null) return false;
  const date = typeof ts === 'object' && ts instanceof Date ? ts : new Date(ts);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return false;
  const now = Date.now();
  return ms >= now - MAX_PAST_MS && ms <= now + MAX_FUTURE_MS;
}

/**
 * Returns the parsed timestamp or null if invalid / outside sanity window.
 * Use for ingest gates: reject or quarantine when null.
 */
export function parseWithinTemporalSanityWindow(
  ts: Date | string | number | null | undefined
): Date | null {
  if (ts == null) return null;
  const date = typeof ts === 'object' && ts instanceof Date ? ts : new Date(ts);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return null;
  if (!isWithinTemporalSanityWindow(date)) return null;
  return date;
}

/**
 * Safe conversion time for sorting. Returns ms for valid dates; null for invalid.
 * Use for defensive sorting: put nulls last.
 */
export function safeConversionTimeMs(ts: string | Date | null | undefined): number | null {
  if (ts == null) return null;
  const date = typeof ts === 'object' && ts instanceof Date ? ts : new Date(ts);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}
