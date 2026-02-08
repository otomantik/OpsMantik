/**
 * Turkish character encoding utilities and formatters.
 */

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
 * Format timestamp with Europe/Istanbul (TRT) timezone.
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

export function formatTimestampWithTZ(
    ts: string | null | undefined,
    options?: Intl.DateTimeFormatOptions
): string {
    if (!ts) return '—';
    const formatted = formatTimestamp(ts, options);
    return `${formatted} (TRT)`;
}

/**
 * Format relative time (e.g., "5m ago").
 */
export function formatRelativeTime(ts: string | null | undefined): string {
    if (!ts) return '—';
    try {
        const date = new Date(ts);
        if (isNaN(date.getTime())) return '—';
        const diffMs = Date.now() - date.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);

        if (diffSec < 60) return 'just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHour < 24) return `${diffHour}h ago`;
        if (diffDay < 7) return `${diffDay}d ago`;
        return formatTimestamp(ts, { month: 'short', day: 'numeric' });
    } catch {
        return '—';
    }
}

/**
 * Lead score labels and colors.
 */
export function getConfidence(score: number): { label: 'HIGH' | 'MEDIUM' | 'LOW'; color: string } {
    if (score >= 80) return { label: 'HIGH', color: 'text-emerald-400' };
    if (score >= 60) return { label: 'MEDIUM', color: 'text-yellow-400' };
    return { label: 'LOW', color: 'text-muted-foreground' };
}

/**
 * Mask fingerprint for UI.
 */
export function maskFingerprint(fp: string | null | undefined): string {
    if (!fp || fp.length === 0) return '—';
    if (fp.length <= 8) return fp;
    return `${fp.slice(0, 4)}...${fp.slice(-4)}`;
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
