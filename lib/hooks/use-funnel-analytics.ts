import useSWR from 'swr';
import { AnalyticsService, FunnelMetrics } from '../services/analytics-service';

/**
 * Hook to fetch conversion funnel and CRO metrics for a specific site.
 */
export function useFunnelAnalytics(siteId: string) {
    const { data, error, isLoading, mutate } = useSWR(
        siteId ? ['funnel-analytics', siteId] : null,
        ([, id]) => AnalyticsService.getFunnelAnalysis(id),
        {
            revalidateOnFocus: false,
            dedupingInterval: 60000, // Cache for 1 minute
        }
    );

    return {
        metrics: data as FunnelMetrics | null,
        loading: isLoading,
        error,
        refetch: mutate,
    };
}
