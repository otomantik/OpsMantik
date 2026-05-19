import { adminClient } from '@/lib/supabase/admin';
import type { PreviousSessionContext, TrafficChannel } from './truth-engine-types';

const DARK_RETURN_MS = 24 * 60 * 60 * 1000;

function channelFromLegacyRow(row: {
  traffic_v2_ledger?: unknown;
  traffic_source?: string | null;
  attribution_source?: string | null;
}): TrafficChannel {
  const ledger = row.traffic_v2_ledger;
  if (ledger && typeof ledger === 'object' && ledger !== null) {
    const ch = (ledger as { channel?: string }).channel;
    if (ch && typeof ch === 'string') return ch as TrafficChannel;
  }
  const src = (row.attribution_source ?? '').toLowerCase();
  if (src.includes('paid') || src.includes('first click')) return 'paid_search';
  const ts = (row.traffic_source ?? '').toLowerCase();
  if (ts.includes('google ads')) return 'paid_search';
  if (ts.includes('maps')) return 'local_maps';
  if (ts === 'seo') return 'organic_search';
  if (ts === 'direct') return 'direct';
  return 'unknown';
}

export type LoadPreviousSessionInput = {
  siteId: string;
  fingerprint: string | null | undefined;
  excludeSessionId?: string | null;
};

/**
 * Loads the most recent prior session within 24h for dark-return rule (shadow ingest only).
 */
export async function loadPreviousSessionContext(
  input: LoadPreviousSessionInput
): Promise<PreviousSessionContext | undefined> {
  const { siteId, fingerprint, excludeSessionId } = input;
  if (!fingerprint?.trim()) return undefined;

  const since = new Date(Date.now() - DARK_RETURN_MS).toISOString();

  const query = adminClient
    .from('sessions')
    .select('id, created_at, traffic_v2_ledger, traffic_source, attribution_source')
    .eq('site_id', siteId)
    .eq('fingerprint', fingerprint)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(3);

  const { data, error } = await query;
  if (error || !data?.length) return undefined;

  const row = data.find((r) => r.id !== excludeSessionId) ?? null;
  if (!row?.created_at) return undefined;

  const channel = channelFromLegacyRow(row);
  return {
    channel,
    timestamp: new Date(row.created_at).getTime(),
  };
}
