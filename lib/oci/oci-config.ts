/**
 * Per-site OCI conversion value configuration.
 *
 * Stored as `oci_config` JSONB on the `sites` table.
 * All fields are optional — system falls back to safe defaults.
 *
 * Value SSOT: V5 sealed value delegates to funnel-kernel computeSealedValue.
 */

import { computeSealedValue } from '@/lib/domain/funnel-kernel/value-formula';

/** Intent stage weights from sites.intent_weights (JSONB). Used for valuation. */
export type IntentWeightsRecord = Record<string, number>;

/** Row shape for site valuation (default_aov, intent_weights) from sites table. */
export interface SiteValuationRow {
    default_aov: number | null;
    intent_weights: IntentWeightsRecord | null;
}

/** Default weights applied when site has no config */
export const OCI_DEFAULT_CONFIG: OciSiteConfig = {
    base_value: 500,
    currency: 'TRY',
    min_star: 3,
    weights: { 3: 0.5, 4: 0.8, 5: 1.0 },
};

export interface OciSiteConfig {
    /** Baseline conversion value (5-star reference). Default: 500. */
    base_value: number;
    /** ISO currency code. Default: TRY. */
    currency: string;
    /**
     * Minimum star rating to send a conversion.
     * Calls with star < min_star are NOT enqueued. Default: 3.
     */
    min_star: number;
    /**
     * Multiplier per star rating.
     * value_sent = base_value × weights[star]
     * If star not found in weights map, uses base_value directly.
     */
    weights: Record<number, number>;
}

/**
 * Parse a raw DB oci_config value into a validated OciSiteConfig.
 * Falls back to OCI_DEFAULT_CONFIG for any missing/invalid field.
 * When base_value is missing, uses defaultAovFallback (sites.default_aov) if provided.
 */
export function parseOciConfig(raw: unknown, defaultAovFallback?: number | null): OciSiteConfig {
    const fallbackBase = defaultAovFallback != null && Number.isFinite(defaultAovFallback) && defaultAovFallback > 0
        ? defaultAovFallback
        : OCI_DEFAULT_CONFIG.base_value;

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ...OCI_DEFAULT_CONFIG, base_value: fallbackBase, weights: { ...OCI_DEFAULT_CONFIG.weights } };
    }

    const cfg = raw as Record<string, unknown>;

    const baseValue =
        typeof cfg.base_value === 'number' && cfg.base_value > 0
            ? cfg.base_value
            : fallbackBase;

    const currency =
        typeof cfg.currency === 'string' && cfg.currency.trim().length >= 3
            ? cfg.currency.trim().toUpperCase().slice(0, 3)
            : OCI_DEFAULT_CONFIG.currency;

    const minStar =
        typeof cfg.min_star === 'number' && cfg.min_star >= 1 && cfg.min_star <= 5
            ? Math.round(cfg.min_star)
            : OCI_DEFAULT_CONFIG.min_star;

    let weights: Record<number, number> = { ...OCI_DEFAULT_CONFIG.weights };
    if (cfg.weights && typeof cfg.weights === 'object' && !Array.isArray(cfg.weights)) {
        const w: Record<number, number> = {};
        for (const [k, v] of Object.entries(cfg.weights as Record<string, unknown>)) {
            const star = parseInt(k, 10);
            if (!Number.isNaN(star) && star >= 1 && star <= 5 && typeof v === 'number' && v >= 0) {
                w[star] = v;
            }
        }
        if (Object.keys(w).length > 0) weights = w;
    }

    return { base_value: baseValue, currency, min_star: minStar, weights };
}

/**
 * Compute V5 sealed conversion value (currency units). Delegates to funnel-kernel computeSealedValue.
 *
 * - sale_amount > 0 → use actual revenue (operatör satış girmiş). SSOT: funnel-kernel computeSealedValue.
 * - sale_amount null/0/negative → return null → caller must NOT enqueue (0 TL mühür olmaz).
 */
export function computeConversionValue(
    _star: number | null,
    saleAmount: number | null,
): number | null {
    if (saleAmount === null || saleAmount === undefined || !Number.isFinite(saleAmount) || saleAmount <= 0) {
        return null;
    }
    return computeSealedValue(Math.round(saleAmount * 100));
}
