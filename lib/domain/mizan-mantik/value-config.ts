/**
 * Value SSOT Config — Single source for site value parameters.
 * PR-VK-1: Config getter with in-memory cache, safe read path, fallbacks.
 *
 * When `sites.oci_config` is present, `IntentWeights` are derived from
 * SiteExportConfig `gear_weights` (V2→pending, V3→qualified, V4→proposal) so
 * Mizan `insertMarketingSignal` matches seal LCV and export math.
 * Legacy `sites.intent_weights` is used only when `oci_config` is absent.
 */

import { majorToMinor } from '@/lib/i18n/currency';
import { adminClient } from '@/lib/supabase/admin';
import { parseExportConfig } from '@/lib/oci/site-export-config';

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
  /** IANA timezone (from oci_config.timezone, fallback 'Europe/Istanbul') */
  timezone: string;
}

export interface NormalizedIntentWeights {
  pending: number;
  qualified: number;
  proposal: number;
  sealed: number;
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
  pending: 2,
  qualified: 20,
  proposal: 30,
  sealed: 100,
};

const GLOBAL_FALLBACK_AOV = 1000;
const GLOBAL_MIN_VALUE_CENTS = 100000; // 1000 TRY
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeWeight(
  weight: number | null | undefined,
  fallbackWeight: number | null | undefined = 0
): number {
  const candidate =
    typeof weight === 'number' && Number.isFinite(weight) ? weight : fallbackWeight ?? 0;
  if (!Number.isFinite(candidate)) {
    return 0;
  }
  return clampRatio(candidate <= 1 ? candidate : candidate / 100);
}

export function normalizeIntentWeights(weights?: Partial<IntentWeights> | null): NormalizedIntentWeights {
  return {
    pending: normalizeWeight(weights?.pending, DEFAULT_WEIGHTS.pending),
    qualified: normalizeWeight(weights?.qualified, DEFAULT_WEIGHTS.qualified),
    proposal: normalizeWeight(weights?.proposal, DEFAULT_WEIGHTS.proposal),
    sealed: normalizeWeight(weights?.sealed, DEFAULT_WEIGHTS.sealed),
  };
}

export function resolveFallbackMinor(params: {
  currency?: string | null;
  minConversionValueCents?: number | null;
  v5FallbackValueMajor?: number | null;
}): number {
  const currency = params.currency?.trim() || 'TRY';
  if (
    params.minConversionValueCents != null &&
    Number.isFinite(params.minConversionValueCents) &&
    params.minConversionValueCents > 0
  ) {
    return Math.round(params.minConversionValueCents);
  }
  if (
    params.v5FallbackValueMajor != null &&
    Number.isFinite(params.v5FallbackValueMajor) &&
    params.v5FallbackValueMajor > 0
  ) {
    return Math.max(majorToMinor(params.v5FallbackValueMajor, currency), 1);
  }
  return GLOBAL_MIN_VALUE_CENTS;
}

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
    .select('name, default_aov, intent_weights, min_conversion_value_cents, oci_config')
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
      timezone: 'Europe/Istanbul',
    };
    setCached(siteId, fallback);
    return fallback;
  }

  const ociRaw = (site as { oci_config?: unknown }).oci_config;
  const hasOciConfig =
    ociRaw != null && typeof ociRaw === 'object' && !Array.isArray(ociRaw);
  const exportCfg = hasOciConfig ? parseExportConfig(ociRaw) : null;

  let finalWeights: IntentWeights;
  if (exportCfg) {
    finalWeights = {
      pending: exportCfg.gear_weights.V2,
      qualified: exportCfg.gear_weights.V3,
      proposal: exportCfg.gear_weights.V4,
      sealed: 100,
    };
  } else {
    const dbWeights = (site.intent_weights as Record<string, unknown> | null) ?? {};
    finalWeights = {
      pending: typeof dbWeights.pending === 'number' ? dbWeights.pending : DEFAULT_WEIGHTS.pending,
      qualified: typeof dbWeights.qualified === 'number' ? dbWeights.qualified : DEFAULT_WEIGHTS.qualified,
      proposal: typeof dbWeights.proposal === 'number' ? dbWeights.proposal : DEFAULT_WEIGHTS.proposal,
      sealed: typeof dbWeights.sealed === 'number' ? dbWeights.sealed : DEFAULT_WEIGHTS.sealed,
    };
    if (dbWeights.proposal === null || dbWeights.proposal === undefined || dbWeights.qualified === null || dbWeights.qualified === undefined) {
      console.info(`[VALUE_CONFIG_MERGE] Site ${siteId} için eksik weight'ler fallback ile tamamlandı.`);
    }
  }

  const exportFallback = exportCfg?.default_aov ?? GLOBAL_FALLBACK_AOV;
  const defaultAov = site.default_aov != null && Number.isFinite(Number(site.default_aov))
    ? Number(site.default_aov)
    : exportFallback;
  const minConversionValueCents = resolveFallbackMinor({
    currency: exportCfg?.currency ?? 'TRY',
    minConversionValueCents:
      site.min_conversion_value_cents != null && Number.isFinite(Number(site.min_conversion_value_cents))
        ? Number(site.min_conversion_value_cents)
        : null,
    v5FallbackValueMajor: exportCfg?.v5_fallback_value ?? null,
  });

  const config: ValueConfig = {
    siteId,
    siteName: site.name,
    defaultAov,
    intentWeights: finalWeights,
    minConversionValueCents,
    timezone: exportCfg?.timezone ?? 'Europe/Istanbul',
  };
  setCached(siteId, config);
  return config;
}
