/**
 * Mirrors scripts/sql/won_pipeline_health.sql missing predicate for a single site (read-only).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const ACTIVE = new Set(['QUEUED', 'RETRY', 'PROCESSING', 'BLOCKED_PRECEDING_SIGNALS']);
const COMPLETED = new Set(['COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED']);

async function collectMissingWonPipelineCallIds(
  client: SupabaseClient,
  siteId: string
): Promise<string[]> {
  const { data: qrows, error: qErr } = await client
    .from('offline_conversion_queue')
    .select('call_id, status')
    .eq('site_id', siteId)
    .not('call_id', 'is', null);

  if (qErr) throw qErr;

  const protectedIds = new Set<string>();
  for (const r of qrows || []) {
    const st = (r as { status?: string }).status ?? '';
    const cid = (r as { call_id?: string }).call_id;
    if (!cid) continue;
    if (ACTIVE.has(st) || COMPLETED.has(st)) protectedIds.add(cid);
  }

  const { data: calls, error: cErr } = await client
    .from('calls')
    .select('id')
    .eq('site_id', siteId)
    .not('confirmed_at', 'is', null)
    .or('status.eq.won,oci_status.eq.sealed');

  if (cErr) throw cErr;

  const missingIds: string[] = [];
  for (const row of calls || []) {
    const id = (row as { id?: string }).id;
    if (id && !protectedIds.has(id)) missingIds.push(id);
  }
  return missingIds;
}

/** Ids of won/sealed calls with no protective queue row (same predicate as count). */
export async function listMissingWonPipelineCallIds(
  client: SupabaseClient,
  siteId: string
): Promise<string[]> {
  return collectMissingWonPipelineCallIds(client, siteId);
}

export async function countWonMissingPipelineForSite(
  client: SupabaseClient,
  siteId: string
): Promise<number> {
  const ids = await collectMissingWonPipelineCallIds(client, siteId);
  return ids.length;
}
