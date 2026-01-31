import { adminClient } from '@/lib/supabase/admin';
import { getRecentMonths } from '@/lib/sync-utils';
import { computeAttribution, extractUTM } from '@/lib/attribution';

export class AttributionService {
    static async resolveAttribution(
        currentGclid: string | null,
        fingerprint: string | null,
        url: string,
        referrer: string | null
    ) {
        // 1. Check for past GCLID (Multi-touch)
        let hasPastGclid = false;
        if (!currentGclid && fingerprint) {
            const recentMonths = getRecentMonths(6);
            const { data: pastEvents } = await adminClient
                .from('events')
                .select('metadata, created_at, session_month')
                .not('metadata->gclid', 'is', null)
                .in('session_month', recentMonths) // Partition filter
                .order('created_at', { ascending: false })
                .limit(50);

            if (pastEvents && pastEvents.length > 0) {
                hasPastGclid = pastEvents.some((e: unknown) => {
                    const event = e as { metadata?: { fp?: string; gclid?: string } };
                    return event.metadata?.fp === fingerprint && event.metadata?.gclid;
                });
            }
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
