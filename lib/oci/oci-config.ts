/**
 * Per-site OCI conversion value configuration.
 *
 * Stored as `oci_config` JSONB on the `sites` table.
 * All fields are optional — system falls back to safe defaults.
 *
 * Value SSOT: V5 sealed value delegates to funnel-kernel computeSealedValue.
 * Star-based gating (min_star, weights) was removed — value is driven by
 * saleAmount directly. Use SiteExportConfig for new per-site config.
 */

import { z } from 'zod';
import { minorToMajor } from '@/lib/i18n/currency';
import { resolveConversionValueMinor } from '@/lib/domain/mizan-mantik';
import { parseExportConfig } from '@/lib/oci/site-export-config';

/** 
 * LCV Intelligence Schema (MizanMantik Singularity Config)
 * Strictly validated site-specific intelligence settings.
 */
export const LcvIntelligenceSchema = z.object({
  premium_districts: z.array(z.string()).default([]),
  high_intent_keywords: z.array(z.string()).default([]),
  multipliers: z.record(z.string(), z.number()).default({}),
});

export type LcvIntelligenceConfig = z.infer<typeof LcvIntelligenceSchema>;

/** Intent stage weights from sites.intent_weights (JSONB). Used for valuation. */
export type IntentWeightsRecord = Record<string, number>;

/** Row shape for site valuation (default_aov, intent_weights) from sites table. */
export interface SiteValuationRow {
    default_aov: number | null;
    intent_weights: IntentWeightsRecord | null;
}

export interface OciSiteConfig {
    /** Baseline conversion value (reference). Default: 500. */
    base_value: number;
    /** ISO currency code. Default: TRY. */
    currency: string;
    /** Site-specific intelligence layer (Singularity). */
    intelligence: LcvIntelligenceConfig;
    fallback_value_major?: number;
}

/** Default config applied when site has no oci_config in DB. Aligns with SiteExportConfig defaults. */
export const OCI_DEFAULT_CONFIG: OciSiteConfig = {
    base_value: 1000,
    currency: 'TRY',
    intelligence: LcvIntelligenceSchema.parse({}),
    fallback_value_major: 500,
};

/**
 * Robust Turkish-aware normalization.
 * Fixes "İ/i" and "I/ı" issues for high-precision matching.
 */
export function normalizeTr(str: string | null | undefined): string {
    if (!str) return '';
    return str.toString().trim().toLocaleLowerCase('tr-TR');
}

/**
 * Parse a raw DB oci_config value into a minimal OciSiteConfig.
 * Delegates currency and numeric defaults to `parseExportConfig` (SiteExportConfig Zod SSOT).
 * Legacy `base_value` key in JSON still overrides when present; `defaultAovFallback` wins for enqueue.
 */
export function parseOciConfig(raw: unknown, defaultAovFallback?: number | null): OciSiteConfig {
    const exp = parseExportConfig(raw);

    let baseValue = exp.default_aov;
    let intelligence = OCI_DEFAULT_CONFIG.intelligence;

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const cfg = raw as Record<string, unknown>;
        if (typeof cfg.base_value === 'number' && cfg.base_value > 0) {
            baseValue = cfg.base_value;
        }
        try {
            if (cfg.intelligence) {
                intelligence = LcvIntelligenceSchema.parse(cfg.intelligence);
            }
        } catch {
            // Malformed intelligence — keep defaults
        }
    }

    if (defaultAovFallback != null && Number.isFinite(defaultAovFallback) && defaultAovFallback > 0) {
        baseValue = defaultAovFallback;
    }

    return {
        base_value: baseValue,
        currency: exp.currency,
        intelligence,
        fallback_value_major: exp.v5_fallback_value,
    };
}

/**
 * Compute V5 sealed conversion value in major currency units.
 * Returns saleAmount when present, otherwise canonical fallback.
 *
 * BUG-4 FIX: single round-trip only (saleAmount → cents → units).
 * Previous: computeSealedValue(Math.round(x * 100)) which then divided by 100.
 * That caused double-rounding at precision boundaries (e.g. saleAmount=0.001 → 0 cents → rejected).
 */
export function computeConversionValue(
    saleAmount: number | null,
    options?: {
        currency?: string | null;
        fallbackMinor?: number | null;
        fallbackMajor?: number | null;
    }
): number | null {
    const currency = options?.currency?.trim() || 'TRY';
    const saleAmountMinor =
        saleAmount != null && Number.isFinite(saleAmount)
            ? Math.round(saleAmount * 100)
            : null;

    const resolved = resolveConversionValueMinor({
        gear: 'V5_SEAL',
        currency,
        saleAmountMinor,
        minConversionValueCents: options?.fallbackMinor ?? null,
        fallbackValueMajor: options?.fallbackMajor ?? null,
    });

    return minorToMajor(resolved.valueMinor, currency);
}
