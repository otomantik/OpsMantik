import { adminClient } from '@/lib/supabase/admin';

/**
 * Funnel Analysis Service for CRO Optimization
 */

export interface FunnelMetrics {
    peak_call_hour: number;
    avg_gclid_session_duration: number;
    total_calls: number;
}

export class AnalyticsService {
    /**
     * Fetches conversation funnel and behavior analytics for a specific site.
     */
    static async getFunnelAnalysis(siteId: string): Promise<FunnelMetrics | null> {
        const { data, error } = await adminClient.rpc('analyze_gumus_alanlar_funnel', {
            target_site_id: siteId,
        });

        if (error) {
            console.error('[ANALYTICS] Failed to fetch funnel analysis:', error);
            return null;
        }

        return data?.[0] || null;
    }
}
