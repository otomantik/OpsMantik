/**
 * Value SSOT Config — Single source for site value parameters.
 * PR-VK-1: Config getter with in-memory cache, safe read path, fallbacks.
 */

import { adminClient } from '@/lib/supabase/admin';

export interface IntentWeights {
  pending: number;
  qualified: number;
  proposal: number;
  sealed: number;
}

export interface ValueConfig {
  siteId: string;
  siteName?: string | null;
  defaultAov: number;
  intentWeights: IntentWeights;
  minConversionValueCents: number;
}

/**
 * Signal floor for V2–V4 only.
 * Site-wide min_conversion_value_cents is reserved for V5 fallback and must not flatten
 * the entire funnel. Signals keep a small materiality floor derived from AOV instead.
 */
export function getValueFloorCents(config: ValueConfig): number {
  const ratioCents = Math.round(config.defaultAov * 0.005 * 100);
  return Math.max(ratioCents, 1);
}

export const DEFAULT_WEIGHTS: IntentWeights = {
  pending: 0.02,
  qualified: 0.2,
  proposal: 0.3,
  sealed: 1.0,
};

const GLOBAL_FALLBACK_AOV = 1000;
const GLOBAL_MIN_VALUE_CENTS = 100000; // 1000 TRY
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

/**
 * DB'den site konfigürasyonunu çeker, eksik verileri fallback ile tamamlar.
 * In-memory cache (TTL 3 min) ile yüksek trafikte DB yükünü azaltır.
 */
export async function getSiteValueConfig(siteId: string): Promise<ValueConfig> {
  const cached = getCached(siteId);
  if (cached) return cached;

  const { data: site, error } = await adminClient
    .from('sites')
    .select('name, default_aov, intent_weights, min_conversion_value_cents')
    .eq('id', siteId)
    .single();

  if (error || !site) {
    console.warn(
      '[SITE_MISSING_DEFAULT_AOV] Site not found or error; using global fallback (default_aov=1000, min_conversion_value_cents=100000)',
      { siteId, error: error?.message }
    );
    const fallback: ValueConfig = {
      siteId,
      siteName: 'Unknown Site',
      defaultAov: GLOBAL_FALLBACK_AOV,
      intentWeights: { ...DEFAULT_WEIGHTS },
      minConversionValueCents: GLOBAL_MIN_VALUE_CENTS,
    };
    setCached(siteId, fallback);
    return fallback;
  }

  const dbWeights = (site.intent_weights as Record<string, unknown> | null) ?? {};
  const finalWeights: IntentWeights = {
    pending: typeof dbWeights.pending === 'number' ? dbWeights.pending : DEFAULT_WEIGHTS.pending,
    qualified: typeof dbWeights.qualified === 'number' ? dbWeights.qualified : DEFAULT_WEIGHTS.qualified,
    proposal: typeof dbWeights.proposal === 'number' ? dbWeights.proposal : DEFAULT_WEIGHTS.proposal,
    sealed: typeof dbWeights.sealed === 'number' ? dbWeights.sealed : DEFAULT_WEIGHTS.sealed,
  };

  if (dbWeights.proposal === null || dbWeights.proposal === undefined || dbWeights.qualified === null || dbWeights.qualified === undefined) {
    console.info(`[VALUE_CONFIG_MERGE] Site ${siteId} için eksik weight'ler fallback ile tamamlandı.`);
  }

  const defaultAov = site.default_aov != null && Number.isFinite(Number(site.default_aov))
    ? Number(site.default_aov)
    : GLOBAL_FALLBACK_AOV;
  const minConversionValueCents =
    site.min_conversion_value_cents != null && Number.isFinite(Number(site.min_conversion_value_cents))
      ? Number(site.min_conversion_value_cents)
      : GLOBAL_MIN_VALUE_CENTS;

  const config: ValueConfig = {
    siteId,
    siteName: site.name,
    defaultAov,
    intentWeights: finalWeights,
    minConversionValueCents,
  };
  setCached(siteId, config);
  return config;
}
