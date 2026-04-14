import type { SupabaseClient } from '@supabase/supabase-js';
import { runDeterministicEngineProbe, runAttributionPaidSurfaceParity } from '@/lib/domain/deterministic-engine';
import { adminClient } from '@/lib/supabase/admin';
import { getRecentMonths } from '@/lib/sync-utils';
import { computeAttribution, extractUTM, sanitizeClickId } from '@/lib/attribution';

export interface ResolveAttributionOptions {
    /** For tests: inject a mock client so past-GCLID lookup is site-scoped in the test double. */
    client?: SupabaseClient;
}

export class AttributionService {
    /**
     * Resolve attribution for the current request. All event lookups are scoped by site_id
     * to prevent cross-tenant attribution bleed (same fingerprint on another site must not
     * influence this site's attribution).
     */
    static async resolveAttribution(
        siteId: string,
        currentGclid: string | null,
        fingerprint: string | null,
        url: string,
        referrer: string | null,
        options?: ResolveAttributionOptions
    ) {
        const client = options?.client ?? adminClient;
        const sanitizedCurrentGclid = sanitizeClickId(currentGclid) ?? null;

        // 1. Check for past GCLID (Multi-touch) — MUST be site-scoped + fingerprint in SQL
        let hasPastGclid = false;
        if (!sanitizedCurrentGclid && fingerprint) {
            const recentMonths = getRecentMonths(6);
            const { data: pastEvent } = await client
                .from('events')
                .select('id')
                .eq('site_id', siteId)
                .eq('metadata->>fingerprint', fingerprint)
                .not('metadata->gclid', 'is', null)
                .in('session_month', recentMonths)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            hasPastGclid = pastEvent != null;
        }

        // 2. Extract UTM
        const utm = extractUTM(url);

        // 3. Compute Attribution
        const attribution = computeAttribution({
            gclid: sanitizedCurrentGclid,
            utm,
            referrer: referrer || null,
            fingerprint,
            hasPastGclid,
        });

        runDeterministicEngineProbe({ kind: 'attribution_resolve', siteId });

        runAttributionPaidSurfaceParity({
          siteId,
          url,
          referrer,
          sanitizedGclid: sanitizedCurrentGclid,
          utm,
          attribution,
        });

        return { attribution, utm, hasPastGclid };
    }
}
