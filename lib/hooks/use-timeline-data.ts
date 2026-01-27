/**
 * Hook for fetching timeline chart data
 * 
 * Fetches aggregated data points for timeline visualization.
 * Auto-granularity based on date range:
 * - < 7 days: hourly
 * - 7-30 days: daily
 * - > 30 days: weekly
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DateRange } from './use-dashboard-date-range';

export interface TimelinePoint {
  date: string; // ISO date string
  label: string; // Formatted label for display
  visitors: number;
  events: number;
  calls: number;
  intents: number; // Calls with status='intent'
  conversions: number; // Calls with status='confirmed'/'qualified'/'real' + conversion events
}

export function useTimelineData(
  siteId: string | undefined,
  dateRange: DateRange
) {
  const [data, setData] = useState<TimelinePoint[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTimeline = useCallback(async () => {
    if (!siteId) return;

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      
      // Use RPC function for server-side aggregation (v2.2 contract)
      const { data: timelineData, error: rpcError } = await supabase.rpc('get_dashboard_timeline', {
        p_site_id: siteId,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_granularity: 'auto'
      });

      if (rpcError) throw rpcError;

      // FIX 2: Transform RPC response to TimelinePoint[] with defensive parsing
      if (timelineData && Array.isArray(timelineData)) {
        const transformed = timelineData.map((point: any) => ({
          date: typeof point.date === 'string' ? point.date : new Date().toISOString(),
          label: typeof point.label === 'string' ? point.label : '',
          visitors: typeof point.visitors === 'number' ? point.visitors : 0,
          events: typeof point.events === 'number' ? point.events : 0,
          calls: typeof point.calls === 'number' ? point.calls : 0,
          intents: typeof point.intents === 'number' ? point.intents : 0,
          conversions: typeof point.conversions === 'number' ? point.conversions : 0,
        }));
        setData(transformed);
      } else {
        setData([]);
      }
    } catch (err: unknown) {
      console.error('[useTimelineData] Error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch timeline data';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [siteId, dateRange]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  return { data, loading, error, refetch: fetchTimeline };
}

// Client-side aggregation removed - now using get_dashboard_timeline() RPC (v2.2)
