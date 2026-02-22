/**
 * getLocalizedLabel - Centralized mapper for database-level strings.
 * Ensures consistent translation of device types, attribution sources, and technical events.
 */
export function getLocalizedLabel(raw: string | null | undefined, t: (key: string, params?: Record<string, string | number>) => string): string {
    if (!raw) return '—';

    const l = raw.toLowerCase().trim();

    // Device types
    if (l === 'mobile') return t('device.mobile');
    if (l === 'desktop') return t('device.desktop');
    if (l === 'tablet') return t('device.tablet');
    if (l === 'iphone') return t('device.iphone');
    if (l === 'android') return t('device.android');

    // Attribution Sources / Dimensions
    if (l === 'google ads') return t('common.dimension.googleAds');
    if (l === 'seo' || l === 'organic') return t('common.dimension.seo');
    if (l === 'social') return t('common.dimension.social');
    if (l === 'direct') return t('common.dimension.direct');
    if (l === 'referral') return t('common.dimension.referral');
    if (l === 'other') return t('common.dimension.other');

    // Specific Attribution Models (Forensic)
    if (l === 'first click (paid)') return t('attribution.firstClickPaid');
    if (l.includes('first click')) return t('attribution.firstClick');
    if (l.includes('last click')) return t('attribution.lastClick');

    // Technical Events
    if (l.includes('whatsapp')) return t('event.whatsapp');
    if (l === 'scroll_depth') return t('event.scrollDepth');
    if (l === 'view') return t('event.view');

    return fixMojibake(raw);
}

function fixMojibake(s: string): string {
    if (!/[ÃÄÅ]/.test(s)) return s;
    try {
        const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        return decoded || s;
    } catch {
        return s;
    }
}
