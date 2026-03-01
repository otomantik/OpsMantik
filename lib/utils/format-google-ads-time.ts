/**
 * Google Ads OCI conversion_time formatter.
 * Dynamic timezone — no hardcoded UTC+3.
 *
 * Format: yyyy-MM-dd HH:mm:ss±HH:mm (e.g. 2026-02-25 18:24:15+03:00)
 * Google Ads Script Validator expects colon in offset. Default: Europe/Istanbul.
 */

import { normalizeTimezone } from '@/lib/i18n/timezone';

/**
 * Format UTC date for Google Ads conversion_time.
 * @param utcDate - Date in UTC (or ISO string)
 * @param timezoneString - IANA timezone (e.g. Europe/Istanbul, Europe/London). Default: Europe/Istanbul
 * @returns yyyy-MM-dd HH:mm:ss±HH:mm (e.g. 2026-02-25 18:24:15+03:00)
 */
export function formatGoogleAdsTime(
  utcDate: Date | string,
  timezoneString?: string | null
): string {
  const tz = normalizeTimezone(timezoneString, 'Europe/Istanbul');
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  if (Number.isNaN(d.getTime())) {
    return formatGoogleAdsTime(new Date(), tz);
  }

  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const base = formatter.format(d);

  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset', // GMT+03:00 (shortOffset GMT+3 script regex'i kırar)
  });
  const offsetParts = offsetFormatter.formatToParts(d);
  const tzPart = offsetParts.find((p) => p.type === 'timeZoneName');
  let raw = (tzPart?.value ?? '+00:00').replace(/^GMT|^UTC/i, '').replace(/\u2212/g, '-').trim();
  const m = raw.match(/^([+-])(\d{1,2}):?(\d{2})$/);
  const offset = m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3]}` : (raw.includes(':') ? raw : raw.replace(/([+-])(\d{2})(\d{2})/, '$1$2:$3'));

  return `${base}${offset}`;
}
