
import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface DashboardStats {
    site_id: string;
    range_days: number;
    total_calls: number;
    total_events: number;
    total_sessions: number;
    unique_visitors: number;
    confirmed_calls: number;
    conversion_rate: number;
    last_event_at: string | null;
    last_call_at: string | null;
}

export function useDashboardStats(siteId: string | undefined, days: number = 7) {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const fetchStats = useCallback(async () => {
        if (!siteId) return;

        setLoading(true);
        setError(null);

        try {
            const supabase = createClient();
            const { data, error: rpcError } = await supabase.rpc('get_dashboard_stats', {
                p_site_id: siteId,
                p_days: days
            });

            if (rpcError) throw rpcError;
            setStats(data);
        } catch (err: unknown) {
            console.error('[useDashboardStats] Error:', err);
            const errorMessage = err instanceof Error ? err.message : 'Failed to fetch dashboard stats';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [siteId, days]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    return { stats, loading, error, refetch: fetchStats };
}
