/**
 * Per-site OCI conversion value configuration.
 *
 * Stored as `oci_config` JSONB on the `sites` table.
 * All fields are optional — system falls back to safe defaults.
 */

import { z } from 'zod';
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

export interface OciSiteConfig {
    /** ISO-4217 currency code. Neutral default: USD. Per-site value resolved from `sites.currency`. */
    currency: string;
    /** Optional site intelligence metadata; does not affect canonical value math. */
    intelligence: LcvIntelligenceConfig;
}

/** Default config applied when site has no oci_config in DB. Neutral (not Turkey-biased). */
export const OCI_DEFAULT_CONFIG: OciSiteConfig = {
    currency: 'USD',
    intelligence: LcvIntelligenceSchema.parse({}),
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
 * Delegates currency defaults to `parseExportConfig` and keeps only non-economic intelligence metadata.
 */
export function parseOciConfig(raw: unknown): OciSiteConfig {
    const exp = parseExportConfig(raw);

    let intelligence = OCI_DEFAULT_CONFIG.intelligence;

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const cfg = raw as Record<string, unknown>;
        try {
            if (cfg.intelligence) {
                intelligence = LcvIntelligenceSchema.parse(cfg.intelligence);
            }
        } catch {
            // Malformed intelligence — keep defaults
        }
    }

    return {
        currency: exp.currency,
        intelligence,
    };
}
