/**
 * Won-queue ordering: block `offline_conversion_queue` until precursors are non-blocking.
 * Checks **both** legacy `marketing_signals` rows and **journal** micro-stages (contacted/offered)
 * for the same call (`hasBlockingPrecedingExports`).
 */

import { adminClient } from '@/lib/supabase/admin';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';

const BLOCKING_DISPATCH = new Set([
  'PENDING',
  'PROCESSING',
  'STALLED_FOR_HUMAN_AUDIT',
]);

function shouldConsultLegacyMarketingSignals(): boolean {
  const raw = (process.env.OCI_PRECEDING_CONSULT_MARKETING_SIGNALS ?? '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

export async function hasBlockingPrecedingMarketingSignals(
  siteId: string,
  callId: string
): Promise<boolean> {
  const names = [OPSMANTIK_CONVERSION_NAMES.contacted, OPSMANTIK_CONVERSION_NAMES.offered];
  const { data, error } = await adminClient
    .from('marketing_signals')
    .select('dispatch_status')
    .eq('site_id', siteId)
    .eq('call_id', callId)
    .in('google_conversion_name', names);

  if (error || !data?.length) {
    return false;
  }

  return data.some((row) =>
    BLOCKING_DISPATCH.has(String((row as { dispatch_status?: string }).dispatch_status ?? ''))
  );
}

/** In-flight precursor rows on the journal (S1) — same semantics as PENDING/PROCESSING marketing_signals. */
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
 * Won-row gate: precursors must be exported (legacy `marketing_signals` backlog and/or journal rows).
 */
export async function hasBlockingPrecedingExports(siteId: string, callId: string): Promise<boolean> {
  const journal = await hasBlockingPrecedingJournalMicroStages(siteId, callId);
  if (journal) return true;
  if (!shouldConsultLegacyMarketingSignals()) return false;
  return hasBlockingPrecedingMarketingSignals(siteId, callId);
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
