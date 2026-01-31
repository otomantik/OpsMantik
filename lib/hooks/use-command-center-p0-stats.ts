import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';

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

  inbox_zero_now: boolean;
}

export type CommandCenterRange = { fromIso: string; toIso: string };

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
  const [stats, setStats] = useState<CommandCenterP0Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scope = options?.scope ?? 'ads';
  const adsOnly = scope === 'ads';

  const dateRange = useMemo(() => {
    if (rangeOverride?.fromIso && rangeOverride?.toIso) return rangeOverride;
    const { fromIso, toIso } = getTodayTrtUtcRange();
    return { fromIso, toIso };
  }, [rangeOverride?.fromIso, rangeOverride?.toIso]);

  const fetchStats = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc('get_command_center_p0_stats_v2', {
        p_site_id: siteId,
        p_date_from: dateRange.fromIso,
        p_date_to: dateRange.toIso,
        p_ads_only: adsOnly,
      });
      if (rpcError) throw rpcError;
      setStats((data as CommandCenterP0Stats) ?? null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load P0 stats');
    } finally {
      setLoading(false);
    }
  }, [dateRange.fromIso, dateRange.toIso, siteId, adsOnly]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats, dateRange };
}

