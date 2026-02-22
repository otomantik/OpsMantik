/**
 * Lightweight locale i18n — normalization, resolution, formatting.
 * Never throws in runtime paths.
 */

const LOCALE_REGEX = /^[a-z]{2}(-[A-Z][a-z0-9]*)*$/i;

/** Normalize BCP-47 locale. Returns fallback on invalid. */
export function normalizeLocale(loc: string | null | undefined, fallback = 'en-US'): string {
  try {
    if (loc == null || typeof loc !== 'string') return fallback;
    const s = String(loc).trim();
    if (!s) return fallback;
    if (LOCALE_REGEX.test(s)) return s;
    return fallback;
  } catch {
    return fallback;
  }
}

/** Resolve locale from cookie, site, user, or header. Cookie (user preference) takes precedence. */
export function resolveLocale(
  site: { locale?: string | null } | null | undefined,
  userMetadata?: { locale?: string } | null,
  acceptLanguage?: string | null,
  cookieLocale?: string | null
): string {
  try {
    if (cookieLocale && typeof cookieLocale === 'string' && cookieLocale.trim()) {
      const base = cookieLocale.trim().split('-')[0]?.toLowerCase();
      if (base === 'tr') return 'tr-TR';
      if (base === 'en') return 'en-US';
      if (base === 'it') return 'it-IT';
      return normalizeLocale(cookieLocale, 'en-US');
    }
    if (site?.locale && typeof site.locale === 'string') {
      return normalizeLocale(site.locale, 'en-US');
    }
    if (userMetadata?.locale && typeof userMetadata.locale === 'string') {
      return normalizeLocale(userMetadata.locale, 'en-US');
    }
    if (acceptLanguage && typeof acceptLanguage === 'string') {
      const first = acceptLanguage.split(',')[0]?.trim();
      if (first) {
        const base = first.split('-')[0]?.toLowerCase();
        if (base === 'tr') return 'tr-TR';
        if (base === 'en') return 'en-US';
        return normalizeLocale(first, 'en-US');
      }
    }
    return 'en-US';
  } catch {
    return 'en-US';
  }
}

/** Format timestamp with timezone. Never throws. */
export function formatTimestamp(
  ts: string | null | undefined,
  timezone: string,
  locale = 'en-US',
  options?: Intl.DateTimeFormatOptions
): string {
  try {
    if (!ts) return '—';
    const date = new Date(ts);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString(locale, {
      timeZone: timezone,
      ...options,
    });
  } catch {
    return '—';
  }
}
