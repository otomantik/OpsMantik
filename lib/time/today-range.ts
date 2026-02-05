/**
 * Phase B1: Default TODAY range (TRT) via server redirect.
 *
 * Requirements:
 * - Compute day start/end in a given IANA timezone and convert to UTC ISO strings
 * - Half-open range: [from, to) where to = next day start
 *
 * Notes:
 * - Default timezone is Europe/Istanbul (TRT).
 * - We intentionally keep this dependency-free (no moment/luxon).
 */
export const DEFAULT_TIMEZONE = 'Europe/Istanbul';
// Kept for backward compatibility (TRT is UTC+03 year-round)
export const TRT_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

export type UtcIsoRange = { fromIso: string; toIso: string };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Returns a YYYY-MM-DD string representing "today" in the given timezone.
 */
export function getTodayDateKey(timezone: string = DEFAULT_TIMEZONE, nowUtc: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(nowUtc);

  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  if (!y || !m || !d) {
    // Fail closed to TRT fallback
    return getTodayTrtDateKey(nowUtc);
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Internal helper: get Y/M/D/H/M/S parts in a given timezone for a UTC Date.
 */
function getZonedParts(dateUtc: Date, timezone: string): {
  y: number; m: number; d: number; hh: number; mm: number; ss: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(dateUtc);

  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value);
  const ss = Number(parts.find((p) => p.type === 'second')?.value);
  return { y, m, d, hh, mm, ss };
}

/**
 * Given a date key (YYYY-MM-DD) in a timezone, returns UTC ISO [from,to) for that local day.
 * Handles DST correctly by computing local midnights for both the day and the next day.
 */
export function dateKeyToUtcRange(dateKey: string, timezone: string = DEFAULT_TIMEZONE): UtcIsoRange {
  const [ys, ms, ds] = dateKey.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!y || !m || !d) {
    throw new Error(`Invalid dateKey: ${dateKey}`);
  }

  const desiredPseudoUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);

  // Iteratively adjust: find the UTC instant that formats to local midnight.
  let utcMs = desiredPseudoUtcMs;
  for (let i = 0; i < 3; i++) {
    const parts = getZonedParts(new Date(utcMs), timezone);
    const actualPseudoUtcMs = Date.UTC(parts.y, parts.m - 1, parts.d, parts.hh, parts.mm, parts.ss, 0);
    const delta = desiredPseudoUtcMs - actualPseudoUtcMs;
    if (delta === 0) break;
    utcMs += delta;
  }
  const fromUtcMs = utcMs;

  // Next day key (calendar +1)
  const nextUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0) + 24 * 60 * 60 * 1000);
  const nextKey = `${nextUtc.getUTCFullYear()}-${pad2(nextUtc.getUTCMonth() + 1)}-${pad2(nextUtc.getUTCDate())}`;

  // Compute next local midnight
  const [ny, nm, nd] = nextKey.split('-').map(Number);
  const desiredNextPseudoUtcMs = Date.UTC(ny, nm - 1, nd, 0, 0, 0, 0);
  let utcMsNext = desiredNextPseudoUtcMs;
  for (let i = 0; i < 3; i++) {
    const parts = getZonedParts(new Date(utcMsNext), timezone);
    const actualPseudoUtcMs = Date.UTC(parts.y, parts.m - 1, parts.d, parts.hh, parts.mm, parts.ss, 0);
    const delta = desiredNextPseudoUtcMs - actualPseudoUtcMs;
    if (delta === 0) break;
    utcMsNext += delta;
  }
  const toUtcMs = utcMsNext;

  return {
    fromIso: new Date(fromUtcMs).toISOString(),
    toIso: new Date(toUtcMs).toISOString(),
  };
}

/**
 * Back-compat: Returns a YYYY-MM-DD string representing "today" in TRT.
 */
export function getTodayTrtDateKey(nowUtc: Date = new Date()): string {
  // Fast-path for TRT to avoid Intl cost
  const trtNow = new Date(nowUtc.getTime() + TRT_UTC_OFFSET_MS);
  const y = trtNow.getUTCFullYear();
  const m = trtNow.getUTCMonth() + 1;
  const d = trtNow.getUTCDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Back-compat: Given a TRT date key (YYYY-MM-DD), returns UTC ISO [from,to) for that TRT day.
 */
export function trtDateKeyToUtcRange(dateKey: string): UtcIsoRange {
  // TRT has fixed offset; keep the previous fast-path
  const [ys, ms, ds] = dateKey.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!y || !m || !d) {
    throw new Error(`Invalid TRT dateKey: ${dateKey}`);
  }

  const fromUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - TRT_UTC_OFFSET_MS;
  const toUtcMs = fromUtcMs + 24 * 60 * 60 * 1000;

  return {
    fromIso: new Date(fromUtcMs).toISOString(),
    toIso: new Date(toUtcMs).toISOString(),
  };
}

/**
 * Returns UTC ISO [from,to) for "today" in TRT (or an optional timezone).
 * Intended to be called on the server boundary (redirect) to avoid hydration mismatch.
 *
 * @example
 * // If TRT today is 2025-01-28: from = 2025-01-27T21:00:00.000Z, to = 2025-01-28T21:00:00.000Z
 * // Example redirect URL: /dashboard/site/[siteId]?from=2025-01-27T21:00:00.000Z&to=2025-01-28T21:00:00.000Z
 */
export function getTodayTrtUtcRange(nowUtc: Date = new Date(), timezone: string = DEFAULT_TIMEZONE): UtcIsoRange {
  // Default behavior remains TRT. If caller provides a different timezone, use generic conversion.
  if (!timezone || timezone === DEFAULT_TIMEZONE) {
    const key = getTodayTrtDateKey(nowUtc);
    return trtDateKeyToUtcRange(key);
  }
  const key = getTodayDateKey(timezone, nowUtc);
  return dateKeyToUtcRange(key, timezone);
}

