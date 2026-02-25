/**
 * Per-site OCI conversion value configuration.
 *
 * Stored as `oci_config` JSONB on the `sites` table.
 * All fields are optional — system falls back to safe defaults.
 */

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
 */
export function parseOciConfig(raw: unknown): OciSiteConfig {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ...OCI_DEFAULT_CONFIG, weights: { ...OCI_DEFAULT_CONFIG.weights } };
    }

    const cfg = raw as Record<string, unknown>;

    const baseValue =
        typeof cfg.base_value === 'number' && cfg.base_value > 0
            ? cfg.base_value
            : OCI_DEFAULT_CONFIG.base_value;

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
 * Compute the conversion value (in currency units, not cents) for a given star rating.
 *
 * Returns null if the star is below min_star → caller should NOT enqueue this conversion.
 * Returns actual revenue (saleAmount) if provided and > 0, regardless of star.
 */
export function computeConversionValue(
    star: number | null,
    saleAmount: number | null,
    config: OciSiteConfig
): number | null {
    // Always use actual revenue if operator entered it
    if (saleAmount != null && Number.isFinite(saleAmount) && saleAmount > 0) {
        return saleAmount;
    }

    // No star → can't compute
    if (star == null || !Number.isFinite(star)) return null;

    const s = Math.round(star);

    // Below threshold → signal skip
    if (s < config.min_star) return null;

    // Apply weight
    const weight = config.weights[s] ?? 1.0;
    return Math.round(config.base_value * weight * 100) / 100;
}
