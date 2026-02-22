/**
 * Lightweight timezone i18n — normalization, resolution.
 * Never throws in runtime paths.
 * Does NOT modify SQL/timezone logic.
 */

const IANA_REGEX = /^[A-Za-z][A-Za-z0-9_+-]+\/[A-Za-z][A-Za-z0-9_+-]+$/;

/** Normalize IANA timezone. Returns fallback on invalid. */
export function normalizeTimezone(tz: string | null | undefined, fallback = 'UTC'): string {
  try {
    if (tz == null || typeof tz !== 'string') return fallback;
    const s = String(tz).trim();
    if (!s) return fallback;
    if (IANA_REGEX.test(s)) return s;
    if (s === 'UTC' || s === 'utc') return 'UTC';
    return fallback;
  } catch {
    return fallback;
  }
}

/** Resolve timezone from site. Legacy: Europe/Istanbul. */
export function resolveTimezone(
  site: { timezone?: string | null } | null | undefined
): string {
  try {
    if (site?.timezone && typeof site.timezone === 'string') {
      return normalizeTimezone(site.timezone, 'UTC');
    }
    return 'UTC';
  } catch {
    return 'UTC';
  }
}
