/**
 * Site-scoped ingest config from sites.config (JSONB).
 * Used to gate ghost geo, traffic debloat, and 10s session reuse per site.
 * Absence of a flag = disabled (no behavior change).
 */

import { adminClient } from '@/lib/supabase/admin';

/** Optional shape for partial config from DB (internal). */
export interface SiteIngestConfig {
    ingest_strict_mode?: boolean;
    ghost_geo_strict?: boolean;
    traffic_debloat?: boolean;
    page_view_10s_session_reuse?: boolean;
    referrer_allowlist?: string[];
    referrer_blocklist?: string[];
    ingest_allow_preview_uas?: boolean;
}

/**
 * Strict return type: all boolean flags are always defined (default false).
 * Prevents undefined property access crashes at call sites.
 */
export interface StrictSiteIngestConfig {
    ingest_strict_mode: boolean;
    ghost_geo_strict: boolean;
    traffic_debloat: boolean;
    page_view_10s_session_reuse: boolean;
    ingest_allow_preview_uas: boolean;
    referrer_allowlist: string[];
    referrer_blocklist: string[];
}

const DEFAULT_STRICT_CONFIG: StrictSiteIngestConfig = {
    ingest_strict_mode: false,
    ghost_geo_strict: false,
    traffic_debloat: false,
    page_view_10s_session_reuse: false,
    ingest_allow_preview_uas: false,
    referrer_allowlist: [],
    referrer_blocklist: [],
};

/**
 * Load ingest config for a site by UUID.
 * Returns StrictSiteIngestConfig so every flag is defined (no undefined access).
 */
export async function getSiteIngestConfig(siteIdUuid: string): Promise<StrictSiteIngestConfig> {
    const { data, error } = await adminClient
        .from('sites')
        .select('config')
        .eq('id', siteIdUuid)
        .maybeSingle();

    if (error || !data) return { ...DEFAULT_STRICT_CONFIG };

    const config = (data.config ?? {}) as Record<string, unknown>;
    const prodDefaultGhostStrict = process.env.NODE_ENV === 'production';
    const out: StrictSiteIngestConfig = {
        ingest_strict_mode: typeof config.ingest_strict_mode === 'boolean' ? config.ingest_strict_mode : false,
        // Default-safe policy: production sites run ghost quarantine unless explicitly overridden.
        ghost_geo_strict: typeof config.ghost_geo_strict === 'boolean' ? config.ghost_geo_strict : prodDefaultGhostStrict,
        traffic_debloat: typeof config.traffic_debloat === 'boolean' ? config.traffic_debloat : false,
        page_view_10s_session_reuse: typeof config.page_view_10s_session_reuse === 'boolean' ? config.page_view_10s_session_reuse : false,
        ingest_allow_preview_uas: typeof config.ingest_allow_preview_uas === 'boolean' ? config.ingest_allow_preview_uas : false,
        referrer_allowlist: Array.isArray(config.referrer_allowlist)
            ? config.referrer_allowlist.filter((x): x is string => typeof x === 'string')
            : [],
        referrer_blocklist: Array.isArray(config.referrer_blocklist)
            ? config.referrer_blocklist.filter((x): x is string => typeof x === 'string')
            : [],
    };

    if (!out.referrer_allowlist.length && typeof process.env.REFERRER_ALLOWLIST_CSV === 'string') {
        out.referrer_allowlist = process.env.REFERRER_ALLOWLIST_CSV.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (!out.referrer_blocklist.length && typeof process.env.REFERRER_BLOCKLIST_CSV === 'string') {
        out.referrer_blocklist = process.env.REFERRER_BLOCKLIST_CSV.split(',').map((s) => s.trim()).filter(Boolean);
    }

    return out;
}
