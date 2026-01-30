/**
 * useSiteConfig — Fetch site row for config (bounty_chips, currency).
 * Used by SealModal / Casino Kasa UI.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { SiteConfig } from '@/lib/types/database';

const DEFAULT_BOUNTY_CHIPS = [1000, 5000, 10000, 25000];
const DEFAULT_CURRENCY = 'TRY';

export interface SiteConfigResult {
  config: SiteConfig | null;
  bountyChips: number[];
  currency: string;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useSiteConfig(siteId: string | null): SiteConfigResult {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!siteId) {
      setConfig(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: e } = await supabase
        .from('sites')
        .select('config')
        .eq('id', siteId)
        .single();

      if (e) {
        setError(e.message);
        setConfig(null);
        return;
      }
      const raw = (data?.config as SiteConfig) ?? {};
      setConfig(raw);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const bountyChips = (config?.bounty_chips != null
    ? Array.isArray(config.bounty_chips)
      ? (config.bounty_chips as number[]).filter((n) => typeof n === 'number' && n >= 0)
      : typeof config.bounty_chips === 'object' && config.bounty_chips !== null
        ? Object.values(config.bounty_chips).filter((n) => typeof n === 'number' && n >= 0)
        : []
    : DEFAULT_BOUNTY_CHIPS);
  const chips = bountyChips.length > 0 ? bountyChips : DEFAULT_BOUNTY_CHIPS;
  const currency = (config?.currency as string) ?? DEFAULT_CURRENCY;

  return {
    config,
    bountyChips: chips,
    currency,
    loading,
    error,
    refetch: fetchConfig,
  };
}
