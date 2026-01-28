
import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface DashboardStats {
    site_id: string;
    range_days: number;
    total_events: number;
    // Ads Command Center KPIs (authoritative)
    ads_sessions: number;
    high_intent: number;
    phone_click_intents?: number;
    whatsapp_click_intents?: number;
    forms?: number;
    forms_enabled?: boolean;
    sealed: number;
    cvr: number;
    // Backward-compat (deprecated; kept for safety)
    total_calls?: number;
    total_sessions?: number;
    unique_visitors?: number;
    confirmed_calls?: number;
    conversion_rate?: number;
    last_event_at: string | null;
    last_call_at: string | null;
}

export function useDashboardStats(
    siteId: string | undefined, 
    dateRange?: { from: Date; to: Date }
) {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const fetchStats = useCallback(async () => {
        if (!siteId) return;

        setLoading(true);
        setError(null);

        try {
            const supabase = createClient();
            
            // Calculate date range (default: last 7 days)
            let dateFrom: Date;
            let dateTo: Date = new Date();
            
            if (dateRange) {
                dateFrom = dateRange.from;
                dateTo = dateRange.to;
            } else {
                // Default: last 7 days
                dateFrom = new Date();
                dateFrom.setDate(dateFrom.getDate() - 7);
            }
            
            const { data, error: rpcError } = await supabase.rpc('get_dashboard_stats', {
                p_site_id: siteId,
                p_date_from: dateFrom.toISOString(),
                p_date_to: dateTo.toISOString(),
                // ADS Command Center: enforce Ads-only server-side filter
                p_ads_only: true,
            });

            if (rpcError) throw rpcError;
            
            // Transform response to match interface (backward compatibility)
            if (data) {
                const rangeDays = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24));
                setStats({
                    ...data,
                    range_days: rangeDays
                } as DashboardStats);
            }
        } catch (err: unknown) {
            console.error('[useDashboardStats] Error:', err);
            const errorMessage = err instanceof Error ? err.message : 'Failed to fetch dashboard stats';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [siteId, dateRange]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    return { stats, loading, error, refetch: fetchStats };
}
