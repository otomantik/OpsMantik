/**
 * Hook for fetching breakdown data (sources, devices, cities)
 * 
 * Uses get_dashboard_breakdown RPC for server-side aggregation.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DateRange } from './use-dashboard-date-range';

export type BreakdownDimension = 'source' | 'device' | 'city';

export interface BreakdownItem {
  dimension_value: string;
  count: number;
  percentage: number;
}

export function useBreakdownData(
  siteId: string | undefined,
  dateRange: DateRange,
  dimension: BreakdownDimension
) {
  const [data, setData] = useState<BreakdownItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBreakdown = useCallback(async () => {
    if (!siteId) return;

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const { data: breakdownData, error: rpcError } = await supabase.rpc('get_dashboard_breakdown', {
        p_site_id: siteId,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_dimension: dimension
      });

      if (rpcError) throw rpcError;

      // FIX 2: Transform RPC response with defensive parsing
      if (breakdownData && Array.isArray(breakdownData)) {
        const transformed = breakdownData.map((item: any) => ({
          dimension_value: typeof item.dimension_value === 'string' ? item.dimension_value : 'Unknown',
          count: typeof item.count === 'number' ? item.count : 0,
          percentage: typeof item.percentage === 'number' ? item.percentage : 0,
        }));
        setData(transformed);
      } else {
        setData([]);
      }
    } catch (err: unknown) {
      console.error('[useBreakdownData] Error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch breakdown data';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [siteId, dateRange, dimension]);

  useEffect(() => {
    fetchBreakdown();
  }, [fetchBreakdown]);

  return { data, loading, error, refetch: fetchBreakdown };
}
