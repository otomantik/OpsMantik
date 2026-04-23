export type GeoDecisionSource = 'ADS' | 'IP' | 'UNKNOWN';

export type GeoDecisionReasonCode =
  | 'gclid_attribution_locked'
  | 'gclid_missing_ads_geo_fallback_ip'
  | 'gclid_missing_ads_geo_unknown'
  | 'no_clickid_cf_primary'
  | 'cf_ghost_city_quarantined'
  | 'no_clickid_no_geo';

export interface GeoSignal {
  city?: string | null;
  district?: string | null;
}

export interface GeoDecisionInput {
  hasValidClickId: boolean;
  adsGeo?: GeoSignal | null;
  ipGeo?: GeoSignal | null;
}

export interface GeoDecisionResult {
  source: GeoDecisionSource;
  city: string | null;
  district: string | null;
  reasonCode: GeoDecisionReasonCode;
  confidence: number;
}

const GHOST_GEO_CITIES = new Set([
  'rome',
  'amsterdam',
  'roma',
  'dusseldorf',
  'düsseldorf',
  'ashburn',
  'frankfurt',
  'london',
  'helsinki',
]);

function cleanText(v?: string | null): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (s.toLowerCase() === 'unknown') return null;
  return s;
}

function isGhostCity(city?: string | null, district?: string | null): boolean {
  const c = (city || '').toString().trim().toLowerCase();
  const d = (district || '').toString().trim().toLowerCase();
  return GHOST_GEO_CITIES.has(c) || GHOST_GEO_CITIES.has(d);
}

function normalizeSignal(signal?: GeoSignal | null): GeoSignal {
  const city = cleanText(signal?.city);
  const district = cleanText(signal?.district);
  return { city, district };
}

export function decideGeo(input: GeoDecisionInput): GeoDecisionResult {
  const ads = normalizeSignal(input.adsGeo);
  const ip = normalizeSignal(input.ipGeo);
  const ipGhost = isGhostCity(ip.city, ip.district);
  const hasAdsGeo = Boolean(ads.city || ads.district);
  const hasIpGeo = Boolean(ip.city || ip.district);

  if (input.hasValidClickId) {
    if (hasAdsGeo) {
      return {
        source: 'ADS',
        city: ads.city ?? null,
        district: ads.district ?? null,
        reasonCode: 'gclid_attribution_locked',
        confidence: 95,
      };
    }
    if (hasIpGeo && !ipGhost) {
      return {
        source: 'IP',
        city: ip.city ?? null,
        district: ip.district ?? null,
        reasonCode: 'gclid_missing_ads_geo_fallback_ip',
        confidence: 68,
      };
    }
    return {
      source: 'UNKNOWN',
      city: null,
      district: null,
      reasonCode: 'gclid_missing_ads_geo_unknown',
      confidence: 25,
    };
  }

  if (hasIpGeo && !ipGhost) {
    return {
      source: 'IP',
      city: ip.city ?? null,
      district: ip.district ?? null,
      reasonCode: 'no_clickid_cf_primary',
      confidence: 72,
    };
  }

  if (hasIpGeo && ipGhost) {
    return {
      source: 'UNKNOWN',
      city: null,
      district: null,
      reasonCode: 'cf_ghost_city_quarantined',
      confidence: 10,
    };
  }

  return {
    source: 'UNKNOWN',
    city: null,
    district: null,
    reasonCode: 'no_clickid_no_geo',
    confidence: 5,
  };
}
