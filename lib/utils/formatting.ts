/**
 * Turkish character encoding utilities and formatters.
 */

import type { TranslationKey } from '@/lib/i18n/t';

const DOUBLE_ENCODING_FIXES: [string, string][] = [
    ['Ã‡', 'Ç'], ['Ã§', 'ç'], ['Äž', 'Ğ'], ['ÄŸ', 'ğ'],
    ['Ä°', 'İ'], ['Ä±', 'ı'], ['Ã–', 'Ö'], ['Ã¶', 'ö'],
    ['Åž', 'Ş'], ['ÅŸ', 'ş'], ['Ãœ', 'Ü'], ['Ã¼', 'ü'],
];

function fixDoubleEncoding(str: string): string {
    let out = str;
    for (const [from, to] of DOUBLE_ENCODING_FIXES) {
        out = out.split(from).join(to);
    }
    return out;
}

/**
 * Safely decode URL/UTM-derived text for display.
 */
export function safeDecode(str: string | null | undefined): string {
    if (str == null) return '';
    const s = String(str).trim();
    if (!s) return '';
    const withSpaces = s.replace(/\+/g, ' ');
    let decoded: string;
    try {
        decoded = decodeURIComponent(withSpaces);
    } catch {
        return fixDoubleEncoding(withSpaces);
    }
    return fixDoubleEncoding(decoded);
}

/**
 * Format timestamp for UI display (legacy).
 *
 * Default timezone is Europe/Istanbul for historical back-compat — Turkish
 * customers have been seeing TRT-formatted times since day one. Any
 * `options.timeZone` override takes precedence, so the preferred Phase 5
 * path is to route through `formatTimestampInZone(ts, tz, options)` below
 * with the active site's timezone coming from `useSiteLocale()` /
 * `useSiteTimezone()`.
 *
 * NEW CODE SHOULD PREFER `formatTimestampInZone`. This function is retained
 * unchanged so a non-locale-aware call site doesn't silently shift all its
 * displayed times by the TRT offset.
 */
export function formatTimestamp(
    ts: string | null | undefined,
    options?: Intl.DateTimeFormatOptions
): string {
    if (!ts) return '—';
    try {
        const date = new Date(ts);
        if (isNaN(date.getTime())) return '—';
        return date.toLocaleString('en-GB', {
            timeZone: 'Europe/Istanbul',
            ...options
        });
    } catch {
        return '—';
    }
}

/**
 * Format a timestamp in an explicit IANA timezone — the Phase 5 SSOT for UI
 * time display. Dashboard components should call this with `useSiteTimezone()`
 * so the displayed clock always matches the active site's locale instead of
 * a hardcoded default.
 *
 * Empty / invalid timestamps return `'—'` (same sentinel as `formatTimestamp`).
 * Invalid timezone strings fall back to the provided `fallbackTimeZone` so we
 * never throw on a misconfigured site.
 */
export function formatTimestampInZone(
    ts: string | null | undefined,
    timeZone: string,
    options?: Intl.DateTimeFormatOptions,
    fallbackTimeZone: string = 'UTC'
): string {
    if (!ts) return '—';
    try {
        const date = new Date(ts);
        if (isNaN(date.getTime())) return '—';
        const tz = typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : fallbackTimeZone;
        try {
            return date.toLocaleString('en-GB', { timeZone: tz, ...options });
        } catch {
            return date.toLocaleString('en-GB', { timeZone: fallbackTimeZone, ...options });
        }
    } catch {
        return '—';
    }
}

/**
 * Format relative time (e.g., "5m ago").
 * Passing t() is preferred for proper i18n.
 */
export function formatRelativeTime(ts: string | null | undefined, t?: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
    if (!ts) return '—';
    try {
        const date = new Date(ts);
        if (isNaN(date.getTime())) return '—';
        const diffMs = Date.now() - date.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);

        if (!t) {
            // Fallback to hardcoded Turkish if t is not provided (legacy support)
            if (diffSec < 60) return 'şimdi';
            if (diffMin < 60) return `${diffMin}dk`;
            if (diffHour < 24) return `${diffHour}sa`;
            if (diffDay < 7) return `${diffDay}gün`;
            return formatTimestamp(ts, { month: 'short', day: 'numeric' });
        }

        if (diffSec < 60) return t('common.justNow');
        if (diffMin < 60) return `${diffMin}${t('common.unit.minute.short')}`;
        if (diffHour < 24) return `${diffHour}${t('common.unit.hour.short')}`;
        if (diffDay < 7) return `${diffDay}${t('common.unit.day.short')}`;
        return formatTimestamp(ts, { month: 'short', day: 'numeric' });
    } catch {
        return '—';
    }
}

/** Ghost geo cities (IP edge / CDN / proxy locations, not real client). Never display. */
const GHOST_GEO_CITIES = new Set([
    'rome', 'amsterdam', 'roma',
    'düsseldorf', 'dusseldorf', 'ashburn', 'frankfurt', 'london',
]);

/**
 * Format location for display. UI Gate (PR1): call geo when location_source='gclid', else session geo.
 * Rome/Amsterdam ghost ALWAYS returns null (UI shows Unknown) — deterministic quarantine.
 * Third param (location_source) accepted for API consistency; callers use it for badges (e.g. gclid).
 */
export function formatDisplayLocation(
    city?: string | null,
    district?: string | null,
    _locationSource?: string | null,
): string | null {
    const cityNorm = (city || '').toString().trim().toLowerCase();
    const districtNorm = (district || '').toString().trim().toLowerCase();
    if (GHOST_GEO_CITIES.has(cityNorm) || GHOST_GEO_CITIES.has(districtNorm)) return null;
    const out = formatLocation(city, district);
    return out === '—' ? null : out;
}

/**
 * Format Turkish administrative locations.
 */
export function formatLocation(city?: string | null, district?: string | null): string {
    const cityLabel = safeDecode((city || '').toString().trim());
    const districtLabel = safeDecode((district || '').toString().trim());
    const cityLc = cityLabel.toLowerCase();
    const districtLc = districtLabel.toLowerCase();

    if (!cityLabel && !districtLabel) return '—';
    if (districtLabel && districtLc === 'merkez') {
        return cityLabel ? `${cityLabel} (Merkez)` : 'Merkez';
    }
    if (cityLabel && districtLabel && cityLc === districtLc) return cityLabel;
    if (cityLabel && districtLabel) return `${districtLabel} / ${cityLabel}`;
    return cityLabel || districtLabel || '—';
}
