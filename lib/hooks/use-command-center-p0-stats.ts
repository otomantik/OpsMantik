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
      // Normalize: Supabase/PostgREST may return jsonb as single-element array or raw object
      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      const payload = raw && typeof raw === 'object' && 'sealed' in raw ? raw : null;
      setStats((payload as CommandCenterP0Stats) ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load P0 stats');
    } finally {
      setLoading(false);
    }
  }, [dateRange.fromIso, dateRange.toIso, siteId, adsOnly]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Real-time Poll for Today
  useEffect(() => {
    if (!siteId || !stats || rangeOverride?.day === 'yesterday') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/stats/realtime?siteId=${siteId}`);
        if (!res.ok) return;
        const realtimeData = await res.json();

        setStats(prev => {
          if (!prev) return prev;
          const prevSealed = Number(prev.sealed);
          const prevJunk = Number(prev.junk);
          const prevLeads = Number(prev.total_leads);
          const prevGclid = Number(prev.gclid_leads);
          const cap = Number(realtimeData.captured) || 0;
          const junk = Number(realtimeData.junk) || 0;
          const gclid = Number(realtimeData.gclid) || 0;
          // Overlay Redis data if it's higher than DB (means DB is still processing)
          return {
            ...prev,
            sealed: Math.max(prevSealed, cap),
            junk: Math.max(prevJunk, junk),
            total_leads: Math.max(prevLeads, cap),
            gclid_leads: Math.max(prevGclid, gclid),
          };
        });
      } catch (e) {
        console.error('Realtime poll failed', e);
      }
    }, 10000); // 10s poll for overlay

    return () => clearInterval(interval);
  }, [siteId, rangeOverride?.day, !!stats]);

  return { stats, loading, error, refetch: fetchStats, dateRange };
}

