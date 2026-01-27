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
      
      // Calculate granularity based on range
      const rangeDays = Math.ceil(
        (dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      const granularity = rangeDays <= 7 ? 'hour' : rangeDays <= 30 ? 'day' : 'week';
      
      // For now, use a simple aggregation query
      // TODO: Create RPC function get_dashboard_timeline() for better performance
      
      // Calculate month boundaries for partition filtering
      const startMonth = new Date(dateRange.from.getFullYear(), dateRange.from.getMonth(), 1).toISOString().slice(0, 7) + '-01';
      const endMonth = new Date(dateRange.to.getFullYear(), dateRange.to.getMonth() + 1, 1).toISOString().slice(0, 7) + '-01';

      // Fetch sessions grouped by time bucket (with partition filter)
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('sessions')
        .select('id, created_at, created_month, fingerprint')
        .eq('site_id', siteId)
        .gte('created_month', startMonth)
        .lt('created_month', endMonth)
        .gte('created_at', dateRange.from.toISOString())
        .lte('created_at', dateRange.to.toISOString())
        .order('created_at', { ascending: true });

      if (sessionsError) throw sessionsError;

      // Fetch events (with session join for site_id filter and partition filter)
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('id, session_id, session_month, created_at, event_category, sessions!inner(site_id)')
        .eq('sessions.site_id', siteId)
        .gte('session_month', startMonth)
        .lt('session_month', endMonth)
        .gte('created_at', dateRange.from.toISOString())
        .lte('created_at', dateRange.to.toISOString())
        .order('created_at', { ascending: true });

      if (eventsError) throw eventsError;

      // Fetch calls
      const { data: callsData, error: callsError } = await supabase
        .from('calls')
        .select('id, created_at, status, matched_session_id')
        .eq('site_id', siteId)
        .gte('created_at', dateRange.from.toISOString())
        .lte('created_at', dateRange.to.toISOString())
        .order('created_at', { ascending: true });

      if (callsError) throw callsError;

      // Aggregate data by time bucket
      const aggregated = aggregateByGranularity(
        sessionsData || [],
        eventsData || [],
        callsData || [],
        dateRange,
        granularity
      );

      setData(aggregated);
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

/**
 * Aggregate data by time granularity
 */
function aggregateByGranularity(
  sessions: Array<{ id: string; created_at: string; fingerprint: string | null }>,
  events: Array<{ id: string; created_at: string; event_category: string }>,
  calls: Array<{ id: string; created_at: string; status: string | null }>,
  dateRange: DateRange,
  granularity: 'hour' | 'day' | 'week'
): TimelinePoint[] {
  const buckets: Record<string, {
    visitors: Set<string>;
    events: number;
    calls: number;
    intents: number;
    conversions: number;
  }> = {};

  // Helper to get bucket key
  const getBucketKey = (date: Date): string => {
    const d = new Date(date);
    if (granularity === 'hour') {
      d.setMinutes(0, 0, 0);
      return d.toISOString().slice(0, 13) + ':00:00';
    } else if (granularity === 'day') {
      d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10) + 'T00:00:00';
    } else {
      // Week: start of week (Monday)
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10) + 'T00:00:00';
    }
  };

  // Helper to format label
  const formatLabel = (key: string): string => {
    const date = new Date(key);
    if (granularity === 'hour') {
      return date.toLocaleTimeString('tr-TR', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Istanbul'
      });
    } else if (granularity === 'day') {
      return date.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'Europe/Istanbul'
      });
    } else {
      return date.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'Europe/Istanbul'
      });
    }
  };

  // Aggregate sessions (unique visitors by fingerprint)
  sessions.forEach(session => {
    const key = getBucketKey(new Date(session.created_at));
    if (!buckets[key]) {
      buckets[key] = {
        visitors: new Set(),
        events: 0,
        calls: 0,
        intents: 0,
        conversions: 0,
      };
    }
    if (session.fingerprint) {
      buckets[key].visitors.add(session.fingerprint);
    }
  });

  // Aggregate events
  events.forEach(event => {
    const key = getBucketKey(new Date(event.created_at));
    if (buckets[key]) {
      buckets[key].events++;
      if (event.event_category === 'conversion') {
        buckets[key].conversions++;
      }
    }
  });

  // Aggregate calls
  calls.forEach(call => {
    const key = getBucketKey(new Date(call.created_at));
    if (buckets[key]) {
      buckets[key].calls++;
      if (call.status === 'intent') {
        buckets[key].intents++;
      }
      if (['confirmed', 'qualified', 'real'].includes(call.status || '')) {
        buckets[key].conversions++;
      }
    }
  });

  // Convert to array and sort
  return Object.entries(buckets)
    .map(([key, bucket]) => ({
      date: key,
      label: formatLabel(key),
      visitors: bucket.visitors.size,
      events: bucket.events,
      calls: bucket.calls,
      intents: bucket.intents,
      conversions: bucket.conversions,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
