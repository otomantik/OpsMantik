import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase/admin';
import { getRecentMonths } from '@/lib/sync-utils';
import { computeAttribution, extractUTM } from '@/lib/attribution';

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

        // 1. Check for past GCLID (Multi-touch) — MUST be site-scoped + fingerprint in SQL
        let hasPastGclid = false;
        if (!currentGclid && fingerprint) {
            const recentMonths = getRecentMonths(6);
            const { data: pastEvents } = await client
                .from('events')
                .select('id')
                .eq('site_id', siteId)
                .eq('metadata->>fingerprint', fingerprint)
                .not('metadata->gclid', 'is', null)
                .in('session_month', recentMonths)
                .order('created_at', { ascending: false })
                .limit(1);

            hasPastGclid = !!(pastEvents && pastEvents.length > 0);
        }

        // 2. Extract UTM
        const utm = extractUTM(url);

        // 3. Compute Attribution
        const attribution = computeAttribution({
            gclid: currentGclid,
            utm,
            referrer: referrer || null,
            fingerprint,
            hasPastGclid,
        });

        return { attribution, utm, hasPastGclid };
    }
}
