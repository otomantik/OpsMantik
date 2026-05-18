import type { SupabaseClient } from '@supabase/supabase-js';
import { runDeterministicEngineProbe, runAttributionPaidSurfaceParity } from '@/lib/domain/deterministic-engine';
import { adminClient } from '@/lib/supabase/admin';
import { getRecentMonths } from '@/lib/sync-utils';
import { computeAttribution, extractUTM, sanitizeClickId } from '@/lib/attribution';
import {
  isSourceTruthSsotEnabled,
  resolveSourceTruthForIngest,
  type ResolveSourceTruthResult,
} from '@/lib/attribution/resolve-source-truth';

export interface ResolveAttributionOptions {
    /** For tests: inject a mock client so past-GCLID lookup is site-scoped in the test double. */
    client?: SupabaseClient;
    userAgent?: string;
}

export type ResolveAttributionResult = {
    attribution: { source: string; isPaid: boolean };
    utm: ReturnType<typeof extractUTM>;
    hasPastGclid: boolean;
    sourceTruth?: ResolveSourceTruthResult;
};

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
    ): Promise<ResolveAttributionResult> {
        const client = options?.client ?? adminClient;
        const sanitizedCurrentGclid = sanitizeClickId(currentGclid) ?? null;
        const utm = extractUTM(url);

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

        if (isSourceTruthSsotEnabled()) {
            const sourceTruth = await resolveSourceTruthForIngest({
                site_id: siteId,
                url,
                referrer,
                user_agent: options?.userAgent ?? '',
                fingerprint,
            });

            if (
                sourceTruth.v2.channel === 'dark_return' ||
                sourceTruth.attribution.source === 'Ads Assisted'
            ) {
                hasPastGclid = true;
            }

            runDeterministicEngineProbe({ kind: 'attribution_resolve', siteId });

            return {
                attribution: sourceTruth.attribution,
                utm,
                hasPastGclid,
                sourceTruth,
            };
        }

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
