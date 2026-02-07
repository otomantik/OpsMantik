import { useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';

import useSWR from 'swr';

export interface CommandCenterP0Stats {
  site_id: string;
  date_from: string;
  date_to: string;
  ads_only: boolean;

  queue_pending: number;
  sealed: number;
  junk: number;
  auto_approved: number;

  oci_uploaded: number;
  oci_failed: number;
  oci_matchable_sealed: number;

  assumed_cpc: number;
  currency: string;
  estimated_budget_saved: number;
  projected_revenue: number;

  // Enterprise Metrics
  total_leads: number;
  gclid_leads: number;
  avg_scroll_depth: number;

  inbox_zero_now: boolean;
}

export type CommandCenterRange = { fromIso: string; toIso: string; day?: 'today' | 'yesterday' };

export type CommandCenterScope = 'ads' | 'all';

export interface UseCommandCenterP0StatsOptions {
  /** When 'ads', stats are filtered to ads-attributed traffic only; when 'all', full calls table. */
  scope?: CommandCenterScope;
}

export function useCommandCenterP0Stats(
  siteId: string | undefined,
  rangeOverride?: CommandCenterRange,
  options?: UseCommandCenterP0StatsOptions
) {
  const scope = options?.scope ?? 'ads';
  const adsOnly = scope === 'ads';

  const dateRange = useMemo(() => {
    if (rangeOverride?.fromIso && rangeOverride?.toIso) return rangeOverride;
    // Default to today
    // Note: rangeOverride might be undefined initially, ensure stability
    // Actually getTodayTrtUtcRange returns a new object every time, referential instability?
    // The previous implementation used useMemo, so it was fine.
    // We should keep stability logic.
    return rangeOverride ?? getTodayTrtUtcRange();
  }, [rangeOverride]);

  // Ensure primitives for SWR key
  const fromIso = dateRange.fromIso;
  const toIso = dateRange.toIso;

  const fetcher = async () => {
    if (!siteId) return null;
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc('get_command_center_p0_stats_v2', {
      p_site_id: siteId,
      p_date_from: fromIso,
      p_date_to: toIso,
      p_ads_only: adsOnly,
    });

    if (rpcError) throw rpcError;

    const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
    // Validate shape roughly
    if (raw && typeof raw === 'object' && 'sealed' in raw) {
      return raw as CommandCenterP0Stats;
    }
    return null;
  };

  const key = siteId ? ['get_command_center_p0_stats_v2', siteId, fromIso, toIso, adsOnly] : null;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false, // Don't revalidate on window focus to avoid partial UI jumps
    keepPreviousData: true, // Keep showing old data while fetching new range
  });

  return {
    stats: data ?? null,
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refetch: mutate,
    dateRange
  };
}

