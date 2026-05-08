/**
 * Mirrors scripts/sql/won_pipeline_health.sql missing predicate for a single site (read-only).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const ACTIVE = new Set(['QUEUED', 'RETRY', 'PROCESSING', 'BLOCKED_PRECEDING_SIGNALS']);
const COMPLETED = new Set(['COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED']);
const TERMINAL = new Set(['FAILED', 'DEAD_LETTER_QUARANTINE', 'VOIDED_BY_REVERSAL']);

export type WonPipelineSiteStats = {
  wonTotal: number;
  wonInQueue: number;
  wonCompleted: number;
  wonMissingPipeline: number;
  oldestMissingAgeSeconds: number | null;
};

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

export async function collectWonPipelineSiteStats(
  client: SupabaseClient,
  siteId: string
): Promise<WonPipelineSiteStats> {
  const { data: qrows, error: qErr } = await client
    .from('offline_conversion_queue')
    .select('call_id, status')
    .eq('site_id', siteId)
    .not('call_id', 'is', null);
  if (qErr) throw qErr;

  const { data: calls, error: cErr } = await client
    .from('calls')
    .select('id, confirmed_at')
    .eq('site_id', siteId)
    .not('confirmed_at', 'is', null)
    .or('status.eq.won,oci_status.eq.sealed');
  if (cErr) throw cErr;

  const inQueue = new Set<string>();
  const completed = new Set<string>();
  for (const row of qrows || []) {
    const callId = (row as { call_id?: string | null }).call_id;
    const status = (row as { status?: string | null }).status || '';
    if (!callId) continue;
    if (ACTIVE.has(status)) inQueue.add(callId);
    if (COMPLETED.has(status)) completed.add(callId);
    if (TERMINAL.has(status)) continue;
  }

  let wonTotal = 0;
  let wonInQueue = 0;
  let wonCompleted = 0;
  let wonMissingPipeline = 0;
  let oldestMissingTs: number | null = null;
  for (const row of calls || []) {
    const id = (row as { id?: string | null }).id;
    const confirmedAt = (row as { confirmed_at?: string | null }).confirmed_at;
    if (!id) continue;
    wonTotal += 1;
    if (inQueue.has(id)) wonInQueue += 1;
    if (completed.has(id)) wonCompleted += 1;
    if (!inQueue.has(id) && !completed.has(id)) {
      wonMissingPipeline += 1;
      if (confirmedAt) {
        const ts = new Date(confirmedAt).getTime();
        if (!Number.isNaN(ts)) oldestMissingTs = oldestMissingTs == null ? ts : Math.min(oldestMissingTs, ts);
      }
    }
  }

  const oldestMissingAgeSeconds =
    oldestMissingTs == null ? null : Math.max(0, Math.floor((Date.now() - oldestMissingTs) / 1000));
  return {
    wonTotal,
    wonInQueue,
    wonCompleted,
    wonMissingPipeline,
    oldestMissingAgeSeconds,
  };
}
