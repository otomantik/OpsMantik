/**
 * Hook for get_traffic_source_breakdown_v1 RPC.
 * Returns sources for site + date range.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface BreakdownItem {
  name: string;
  count: number;
  pct: number;
}

export interface TrafficSourceBreakdownData {
  total_sessions: number;
  sources: BreakdownItem[];
}

export interface DateRangeInput {
  from: string | Date;
  to: string | Date;
}

const cache = new Map<string, { data: TrafficSourceBreakdownData; ts: number }>();
const CACHE_TTL_MS = 60_000;

function cacheKey(siteId: string, from: string, to: string): string {
  return `${siteId}|${from}|${to}`;
}

function normalizeRange(range: DateRangeInput): { fromIso: string; toIso: string } {
  const from = typeof range.from === 'string' ? range.from : range.from.toISOString();
  const to = typeof range.to === 'string' ? range.to : range.to.toISOString();
  return { fromIso: from, toIso: to };
}

export function useTrafficSourceBreakdown(siteId: string | undefined, dateRange: DateRangeInput | undefined) {
  const [data, setData] = useState<TrafficSourceBreakdownData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { fromIso, toIso } = dateRange ? normalizeRange(dateRange) : { fromIso: '', toIso: '' };

  const fetchData = useCallback(async () => {
    if (!siteId || !fromIso || !toIso) {
      setData(null);
      setIsLoading(false);
      return;
    }

    const k = cacheKey(siteId, fromIso, toIso);
    const cached = cache.get(k);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setData(cached.data);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_traffic_source_breakdown_v1', {
        p_site_id: siteId,
        p_date_from: fromIso,
        p_date_to: toIso,
        p_limit: 12,
      });

      if (rpcError) throw rpcError;

      const raw = Array.isArray(rpcData) && rpcData.length === 1 ? rpcData[0] : rpcData;
      const result =
        raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as TrafficSourceBreakdownData) : null;

      const safe: TrafficSourceBreakdownData = result && Array.isArray(result.sources)
        ? result
        : { total_sessions: 0, sources: [] };

      setData(safe);
      cache.set(k, { data: safe, ts: Date.now() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch traffic source breakdown';
      setError(msg);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [siteId, fromIso, toIso]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

