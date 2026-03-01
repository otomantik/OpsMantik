/**
 * Google Ads OCI conversion_time formatter.
 *
 * Google Ads CSV bulk upload expects (per support doc 7014069):
 *   yyyy-MM-dd HH:mm:ss+z  where z = +0500 or -0100 (4-digit offset, NO colon)
 * Example: 2026-02-28 10:15:10+0300
 * Regex:   /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{4}$/
 *
 * - No "T" separator.
 * - No milliseconds.
 * - Offset: +0300 (NOT +03:00) — colon causes "invalid" in CSV import.
 */

import { normalizeTimezone } from '@/lib/i18n/timezone';

/** Canonical Google Ads format: yyyy-MM-dd HH:mm:ss±HH:mm (timezone required). */
export const GOOGLE_ADS_TIME_FORMAT = 'yyyy-MM-dd HH:mm:ss±HH:mm' as const;

/** Regex that Google Ads CSV import accepts (offset +0300, no colon). */
export const GOOGLE_ADS_TIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{4}$/;

/** Parse UTC/ISO timestamp string or Date. Returns null if input is null/undefined/invalid. */
export function parseUtcTimestamp(ts: string | Date | null | undefined): Date | null {
  if (ts == null) return null;
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d;
}

/** Assert timestamp is valid. Throws deterministic error if not. */
export function assertValidTimestamp(
  ts: string | Date | null | undefined,
  context: string
): asserts ts is string | Date {
  const parsed = parseUtcTimestamp(ts);
  if (parsed == null) {
    throw new Error(`OCI_INVALID_TIMESTAMP: ${context} must be valid UTC/ISO string or Date, got ${JSON.stringify(ts)}`);
  }
}

/**
 * Core low-level formatter. Formats a valid Date into Google Ads format.
 * Uses sv-SE locale which natively produces "yyyy-MM-dd HH:mm:ss" (space, no T, no ms).
 * Appends explicit UTC offset from longOffset (e.g. +03:00).
 *
 * Output strictly matches: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
 */
function _formatDate(d: Date, tz: string): string {
  const base = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);

  // longOffset produces GMT+3:00 (with colon). Google Ads CSV requires +0300 (no colon).
  const offsetParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(d);

  const tzPart = offsetParts.find((p) => p.type === 'timeZoneName');
  const raw = (tzPart?.value ?? '+00:00')
    .replace(/^GMT|^UTC/i, '')
    .replace(/\u2212/g, '-')
    .trim();

  // Google Ads CSV bulk import expects +0300 (4 digits, NO colon). +03:00 causes "invalid".
  // Intl longOffset returns GMT+3:00 (with colon); we must output +0300 (no colon).
  let offset: string;
  if (!raw || raw === 'Z') {
    offset = '+0000';
  } else {
    const m = raw.match(/^([+-])(\d{1,2}):?(\d{2})$/);
    offset = m
      ? `${m[1]}${m[2].padStart(2, '0')}${m[3]}`
      : raw.replace(/:/g, ''); // Fallback: strip any colons (+03:00 -> +0300)
  }

  // Defensive: ensure offset has no colon (some Intl/Node envs may vary)
  const sanitized = offset.replace(/:/g, '');
  return `${base}${sanitized}`;
}

/**
 * Format a UTC/ISO timestamp for Google Ads conversion_time.
 * Returns yyyy-MM-dd HH:mm:ss±HH:mm in the given IANA timezone.
 *
 * NOTE: If the input is null/undefined/invalid, this falls back to current time.
 * Use formatGoogleAdsTimeOrNull when you need explicit null-safety (export pipeline).
 *
 * @param utcDate - ISO string (e.g. "2026-02-28T07:15:10.000Z") or Date
 * @param timezoneString - IANA timezone. Default: Europe/Istanbul
 */
export function formatGoogleAdsTime(
  utcDate: Date | string,
  timezoneString?: string | null
): string {
  const tz = normalizeTimezone(timezoneString, 'Europe/Istanbul');
  const d = typeof utcDate === 'string' ? parseUtcTimestamp(utcDate) : utcDate;
  const resolved = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  return _formatDate(resolved, tz);
}

/**
 * Null-safe variant for the export pipeline.
 * Returns null if the input is null/undefined/invalid/future instead of silently using current time.
 * Export callers MUST skip the row when this returns null.
 *
 * @param utcDate - ISO string or Date (from calls.confirmed_at / queue.conversion_time)
 * @param timezoneString - IANA timezone. Default: Europe/Istanbul
 */
export function formatGoogleAdsTimeOrNull(
  utcDate: Date | string | null | undefined,
  timezoneString?: string | null
): string | null {
  if (utcDate == null) return null;
  const tz = normalizeTimezone(timezoneString, 'Europe/Istanbul');
  const d = typeof utcDate === 'string' ? parseUtcTimestamp(utcDate) : utcDate;
  if (!(d instanceof Date) || Number.isNaN(d.getTime()) || d.getTime() <= 0) return null;
  const result = _formatDate(d, tz);
  return GOOGLE_ADS_TIME_REGEX.test(result) ? result : null;
}

/**
 * Format for Google Ads OCI: yyyy-MM-dd HH:mm:ss±HH:mm.
 * @deprecated Use formatGoogleAdsTime directly.
 */
export function formatGoogleAdsTimeCompact(
  utcDate: Date | string,
  timezoneString?: string | null
): string {
  return formatGoogleAdsTime(utcDate, timezoneString);
}

/**
 * Strict variant that throws on invalid input.
 * For Seal events: use confirmed_at. For Intent: use created_at.
 */
export function formatGoogleAdsTimeStrict(
  utcDate: Date | string | null | undefined,
  timezoneString: string | null | undefined,
  context: string
): string {
  assertValidTimestamp(utcDate, context);
  return formatGoogleAdsTime(utcDate as Date | string, timezoneString);
}
