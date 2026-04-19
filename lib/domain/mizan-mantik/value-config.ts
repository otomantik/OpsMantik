import { adminClient } from '@/lib/supabase/admin';

export interface ValueConfig {
  siteId: string;
  siteName?: string | null;
  timezone: string;
}
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

type CacheEntry = { config: ValueConfig; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function getCached(siteId: string): ValueConfig | null {
  const entry = cache.get(siteId);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(siteId);
    return null;
  }
  return entry.config;
}

function setCached(siteId: string, config: ValueConfig): void {
  cache.set(siteId, {
    config,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

import { NEUTRAL_TIMEZONE } from '@/lib/i18n/site-locale';

const GLOBAL_TIMEZONE = NEUTRAL_TIMEZONE;

/**
 * Canonical runtime config is intentionally narrow:
 * stage/value math comes from optimization-contract, while this loader only
 * fetches site identity and operational timezone used by forensic helpers.
 */
export async function getSiteValueConfig(siteId: string): Promise<ValueConfig> {
  const cached = getCached(siteId);
  if (cached) return cached;

  const { data: site, error } = await adminClient
    .from('sites')
    .select('name, timezone')
    .eq('id', siteId)
    .single();

  if (error || !site) {
    const fallback: ValueConfig = {
      siteId,
      siteName: 'Unknown Site',
      timezone: GLOBAL_TIMEZONE,
    };
    setCached(siteId, fallback);
    return fallback;
  }

  const config: ValueConfig = {
    siteId,
    siteName: site.name,
    timezone:
      typeof (site as { timezone?: string | null }).timezone === 'string' &&
      (site as { timezone?: string | null }).timezone!.trim()
        ? (site as { timezone?: string | null }).timezone!.trim()
        : GLOBAL_TIMEZONE,
  };
  setCached(siteId, config);
  return config;
}
