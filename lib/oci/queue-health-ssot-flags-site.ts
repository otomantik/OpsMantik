/**
 * Per-site SSOT flags for queue-health (operational API path).
 * Time drift mirrors queue-only occurred_at/conversion_time/source_timestamp checks.
 * Identity mirrors scripts/sql/identity_integrity_health.sql (won/sealed calls).
 * Value integrity is **not** replicated here — use value_integrity_health.sql / release evidence (valueIntegrityRed stays false).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE = 800;

function queueTimeDrifted(row: {
  occurred_at?: string | null;
  conversion_time?: string | null;
  source_timestamp?: string | null;
}): boolean {
  if (row.occurred_at == null || row.conversion_time == null || row.source_timestamp == null) return true;
  if (row.conversion_time !== row.occurred_at) return true;
  return row.source_timestamp !== row.occurred_at;
}

async function anyOfflineQueueTimeDrift(client: SupabaseClient, siteId: string): Promise<boolean> {
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from('offline_conversion_queue')
      .select('occurred_at, conversion_time, source_timestamp')
      .eq('site_id', siteId)
      .not('call_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    if (rows.some((r) => queueTimeDrifted(r as Record<string, unknown>))) return true;
    if (rows.length < PAGE) return false;
    from += PAGE;
  }
}

export async function fetchSiteSsotFlags(client: SupabaseClient, siteId: string): Promise<{
  timeSsotRed: boolean;
  valueIntegrityRed: boolean;
  identityIntegrityRed: boolean;
}> {
  const timeQ = await anyOfflineQueueTimeDrift(client, siteId);

  const hashRe = /^[0-9a-f]{64}$/;
  let identityIntegrityRed = false;
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from('calls')
      .select('caller_phone_hash_sha256, caller_phone_e164')
      .eq('site_id', siteId)
      .or('status.eq.won,oci_status.eq.sealed')
      .order('confirmed_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) {
      const h = (row as { caller_phone_hash_sha256?: string | null }).caller_phone_hash_sha256;
      const e164 = (row as { caller_phone_e164?: string | null }).caller_phone_e164;
      if (h != null && !hashRe.test(h)) {
        identityIntegrityRed = true;
        break;
      }
      if (e164 != null && h == null) {
        identityIntegrityRed = true;
        break;
      }
    }
    if (identityIntegrityRed) break;
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  return {
    timeSsotRed: timeQ,
    valueIntegrityRed: false,
    identityIntegrityRed,
  };
}
