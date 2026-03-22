import { adminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging/logger';

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
        // RPC name is legacy; neutral alias optional — see docs/architecture/adr/002-analytics-funnel-rpc-naming.md
        const { data, error } = await adminClient.rpc('analyze_gumus_alanlar_funnel', {
            target_site_id: siteId,
        });

        if (error) {
            logError('ANALYTICS_FUNNEL_QUERY_FAILED', { site_id: siteId, error: error.message, code: error.code });
            return null;
        }

        return data?.[0] || null;
    }
}
