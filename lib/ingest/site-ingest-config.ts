/**
 * Site-scoped ingest config from sites.config (JSONB).
 * Used to gate ghost geo, traffic debloat, and 10s session reuse per site.
 * Absence of a flag = disabled (no behavior change).
 */

import { adminClient } from '@/lib/supabase/admin';

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
 * Load ingest config for a site by UUID.
 * Reads sites.config; returns empty-like defaults when keys are absent.
 */
export async function getSiteIngestConfig(siteIdUuid: string): Promise<SiteIngestConfig> {
    const { data, error } = await adminClient
        .from('sites')
        .select('config')
        .eq('id', siteIdUuid)
        .maybeSingle();

    if (error || !data) return {};

    const config = (data.config ?? {}) as Record<string, unknown>;
    const out: SiteIngestConfig = {};

    if (typeof config.ingest_strict_mode === 'boolean') out.ingest_strict_mode = config.ingest_strict_mode;
    if (typeof config.ghost_geo_strict === 'boolean') out.ghost_geo_strict = config.ghost_geo_strict;
    if (typeof config.traffic_debloat === 'boolean') out.traffic_debloat = config.traffic_debloat;
    if (typeof config.page_view_10s_session_reuse === 'boolean') out.page_view_10s_session_reuse = config.page_view_10s_session_reuse;
    if (typeof config.ingest_allow_preview_uas === 'boolean') out.ingest_allow_preview_uas = config.ingest_allow_preview_uas;

    if (Array.isArray(config.referrer_allowlist)) {
        out.referrer_allowlist = config.referrer_allowlist.filter((x): x is string => typeof x === 'string');
    }
    if (Array.isArray(config.referrer_blocklist)) {
        out.referrer_blocklist = config.referrer_blocklist.filter((x): x is string => typeof x === 'string');
    }

    // Env fallback for allowlist/blocklist when not in config
    if (!out.referrer_allowlist?.length && typeof process.env.REFERRER_ALLOWLIST_CSV === 'string') {
        out.referrer_allowlist = process.env.REFERRER_ALLOWLIST_CSV.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (!out.referrer_blocklist?.length && typeof process.env.REFERRER_BLOCKLIST_CSV === 'string') {
        out.referrer_blocklist = process.env.REFERRER_BLOCKLIST_CSV.split(',').map((s) => s.trim()).filter(Boolean);
    }

    return out;
}
