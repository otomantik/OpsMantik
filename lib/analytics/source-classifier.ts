/**
 * Traffic Source Classifier
 *
 * Goal: robust, deterministic session channel classification for SEO / Social / Paid.
 *
 * Priority order (high -> low):
 * - Paid Search (Google click ids)
 * - Paid Social (Meta/TikTok click ids)
 * - Direct Paid (utm_medium=cpc/paid)
 * - Organic Search (referrer search engines; no paid ids)
 * - Social (referrer social domains)
 * - Referral (any other referrer)
 * - Direct (no referrer, no params)
 */

export type TrafficClassification = {
  traffic_source: string;
  traffic_medium: string;
  /** Optional human-friendly label (not stored by default). */
  label?: string;
};

function safeUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    try {
      // allow relative URLs
      return new URL(u, 'https://x.invalid');
    } catch {
      return null;
    }
  }
}

function getHost(u: string | null | undefined): string | null {
  if (!u) return null;
  const url = safeUrl(u);
  const h = url?.hostname?.toLowerCase?.().trim?.();
  return h ? h : null;
}

function normStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

function getParamFromObj(params: any, key: string): string | null {
  if (!params || typeof params !== 'object') return null;
  // common casing variations
  const direct = normStr(params[key]);
  if (direct) return direct;
  const lower = key.toLowerCase();
  const byLower = normStr(params[lower]);
  if (byLower) return byLower;
  // try UTM variants, e.g. utm_medium vs utmMedium
  const camel = lower.replace(/_([a-z])/g, (_, c) => String(c).toUpperCase());
  return normStr(params[camel]);
}

function getParam(url: URL | null, params: any, key: string): string | null {
  const fromUrl = url?.searchParams?.get?.(key);
  if (fromUrl && fromUrl.trim()) return fromUrl.trim();
  return getParamFromObj(params, key);
}

function hasAny(url: URL | null, params: any, keys: string[]): boolean {
  return keys.some((k) => Boolean(getParam(url, params, k)));
}

function isSearchRef(host: string): { engine: string } | null {
  const h = host;
  if (h.includes('google.')) return { engine: 'Google' };
  if (h.includes('bing.')) return { engine: 'Bing' };
  if (h.includes('yandex.')) return { engine: 'Yandex' };
  if (h.includes('duckduckgo.')) return { engine: 'DuckDuckGo' };
  return null;
}

function isSocialRef(host: string): { platform: string } | null {
  const h = host;
  // Meta
  if (h.includes('facebook.') || h === 'l.facebook.com' || h === 'm.facebook.com') return { platform: 'Facebook' };
  if (h.includes('instagram.') || h === 'l.instagram.com') return { platform: 'Instagram' };
  // X/Twitter
  if (h === 't.co' || h.includes('twitter.')) return { platform: 'X' };
  // LinkedIn
  if (h.includes('linkedin.')) return { platform: 'LinkedIn' };
  // TikTok
  if (h.includes('tiktok.')) return { platform: 'TikTok' };
  // YouTube (often social/Video)
  if (h.includes('youtube.') || h === 'youtu.be') return { platform: 'YouTube' };
  return null;
}

/**
 * Determine traffic source and medium for a session.
 *
 * @param url - landing URL (can include query params)
 * @param referrer - document.referrer (can be empty)
 * @param params - additional params/metadata (utm_*, click ids, etc). Optional.
 */
export function determineTrafficSource(url: string, referrer: string, params: any): TrafficClassification {
  const pageUrl = safeUrl(url);
  const pageHost = pageUrl?.hostname?.toLowerCase?.() || null;

  const ref = normStr(referrer);
  const refHost = getHost(ref) || null;

  // Treat same-host referrer as internal => direct-like
  const isInternal = Boolean(pageHost && refHost && pageHost === refHost);
  const effectiveRefHost = isInternal ? null : refHost;

  const hasPaidSearch = hasAny(pageUrl, params, ['gclid', 'wbraid', 'gbraid']);
  if (hasPaidSearch) {
    // Channel label (user-facing)
    return { traffic_source: 'Google Ads', traffic_medium: 'cpc' };
  }

  const hasFb = hasAny(pageUrl, params, ['fbclid']);
  const hasTt = hasAny(pageUrl, params, ['ttclid']);
  if (hasFb) {
    return { traffic_source: 'Meta Ads', traffic_medium: 'cpc' };
  }
  if (hasTt) {
    return { traffic_source: 'TikTok Ads', traffic_medium: 'cpc' };
  }

  const utmMedium = (getParam(pageUrl, params, 'utm_medium') || '').toLowerCase();
  const utmSource = getParam(pageUrl, params, 'utm_source');

  // Direct paid (explicit UTMs)
  if (utmMedium === 'cpc' || utmMedium === 'ppc' || utmMedium === 'paid' || utmMedium === 'paidsearch' || utmMedium === 'paid_search') {
    // Keep explicit tags but still user-friendly; allow caller to set utm_source like "facebook".
    const src = (utmSource?.trim() || 'Paid').slice(0, 64);
    return { traffic_source: src, traffic_medium: 'cpc' };
  }

  // Organic search by referrer (only when no paid identifiers)
  if (effectiveRefHost) {
    const se = isSearchRef(effectiveRefHost);
    if (se) {
      return { traffic_source: 'SEO', traffic_medium: 'organic', label: se.engine };
    }

    const social = isSocialRef(effectiveRefHost);
    if (social) {
      return { traffic_source: social.platform, traffic_medium: 'social' };
    }

    // Referral (any other referrer)
    return { traffic_source: 'Referral', traffic_medium: 'referral', label: effectiveRefHost };
  }

  // No referrer. If we have any meaningful tracking params, still classify as direct-paid-ish or tagged.
  const hasAnyParams =
    hasAny(pageUrl, params, ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) ||
    hasAny(pageUrl, params, ['gclid', 'wbraid', 'gbraid', 'fbclid', 'ttclid', 'msclkid']);

  if (!hasAnyParams) {
    return { traffic_source: 'Direct', traffic_medium: 'direct' };
  }

  // Tagged but not identified; treat as "Direct" with medium = (utm_medium or referral-like).
  if (utmMedium) {
    return { traffic_source: utmSource || 'Tagged', traffic_medium: utmMedium };
  }
  return { traffic_source: utmSource || 'Tagged', traffic_medium: 'unknown' };
}

