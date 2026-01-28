/**
 * Phase B1: Default TODAY range (TRT) via server redirect.
 *
 * Requirements:
 * - Compute TRT day start/end and convert to UTC ISO strings
 * - Half-open range: [from, to) where to = next day start
 *
 * Notes:
 * - Turkey (TRT) is UTC+03:00 year-round (no DST).
 * - We intentionally keep this dependency-free for server usage.
 */
export const TRT_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

export type UtcIsoRange = { fromIso: string; toIso: string };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Returns a YYYY-MM-DD string representing "today" in TRT.
 */
export function getTodayTrtDateKey(nowUtc: Date = new Date()): string {
  const trtNow = new Date(nowUtc.getTime() + TRT_UTC_OFFSET_MS);
  const y = trtNow.getUTCFullYear();
  const m = trtNow.getUTCMonth() + 1;
  const d = trtNow.getUTCDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Given a TRT date key (YYYY-MM-DD), returns UTC ISO [from,to) for that TRT day.
 */
export function trtDateKeyToUtcRange(dateKey: string): UtcIsoRange {
  const [ys, ms, ds] = dateKey.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!y || !m || !d) {
    throw new Error(`Invalid TRT dateKey: ${dateKey}`);
  }

  // TRT midnight for that day (00:00 TRT) == UTC (00:00 - 3h)
  const fromUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - TRT_UTC_OFFSET_MS;
  const toUtcMs = fromUtcMs + 24 * 60 * 60 * 1000;

  return {
    fromIso: new Date(fromUtcMs).toISOString(),
    toIso: new Date(toUtcMs).toISOString(),
  };
}

/**
 * Returns UTC ISO [from,to) for "today" in TRT.
 * Intended to be called on the server boundary (redirect) to avoid hydration mismatch.
 *
 * @example
 * // If TRT today is 2025-01-28: from = 2025-01-27T21:00:00.000Z, to = 2025-01-28T21:00:00.000Z
 * // Example redirect URL: /dashboard/site/[siteId]?from=2025-01-27T21:00:00.000Z&to=2025-01-28T21:00:00.000Z
 */
export function getTodayTrtUtcRange(nowUtc: Date = new Date()): UtcIsoRange {
  const key = getTodayTrtDateKey(nowUtc);
  return trtDateKeyToUtcRange(key);
}

