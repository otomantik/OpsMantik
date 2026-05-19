/**
 * Won-queue ordering: block `offline_conversion_queue` until precursors are non-blocking.
 * Queue-only model: checks journal micro-stages (contacted/offered) for same call.
 */

import { adminClient } from '@/lib/supabase/admin';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';

/** In-flight precursor rows on the journal (S1) — QUEUED/PROCESSING micro-stages. */
const BLOCKING_QUEUE_STATUSES = new Set([
  'QUEUED',
  'RETRY',
  'PROCESSING',
  'UPLOADED',
  'BLOCKED_PRECEDING_SIGNALS',
]);

export async function hasBlockingPrecedingJournalMicroStages(
  siteId: string,
  callId: string
): Promise<boolean> {
  const actions = [OPSMANTIK_CONVERSION_NAMES.contacted, OPSMANTIK_CONVERSION_NAMES.offered];
  const { data, error } = await adminClient
    .from('offline_conversion_queue')
    .select('id')
    .eq('site_id', siteId)
    .eq('call_id', callId)
    .in('action', actions)
    .in('status', [...BLOCKING_QUEUE_STATUSES]);

  if (error || !data?.length) {
    return false;
  }
  return true;
}

/**
 * Won-row gate: precursors must be exported on the journal before Won upload.
 */
export async function hasBlockingPrecedingExports(siteId: string, callId: string): Promise<boolean> {
  return hasBlockingPrecedingJournalMicroStages(siteId, callId);
}

export async function resolveWonQueueInitialStatus(siteId: string, callId: string): Promise<{
  status: 'QUEUED' | 'BLOCKED_PRECEDING_SIGNALS';
  blockReason: string | null;
}> {
  const blocking = await hasBlockingPrecedingExports(siteId, callId);
  if (blocking) {
    return {
      status: 'BLOCKED_PRECEDING_SIGNALS',
      blockReason: 'PRECEDING_SIGNALS_NOT_EXPORTED',
    };
  }
  return { status: 'QUEUED', blockReason: null };
}
