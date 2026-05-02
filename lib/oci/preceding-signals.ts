/**
 * Won-queue ordering: block offline_conversion_queue until precursor marketing_signals
 * (OpsMantik_Contacted / OpsMantik_Offered) are past blocking dispatch states.
 */

import { adminClient } from '@/lib/supabase/admin';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/domain/mizan-mantik/conversion-names';

const BLOCKING_DISPATCH = new Set([
  'PENDING',
  'PROCESSING',
  'STALLED_FOR_HUMAN_AUDIT',
]);

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

export async function resolveWonQueueInitialStatus(siteId: string, callId: string): Promise<{
  status: 'QUEUED' | 'BLOCKED_PRECEDING_SIGNALS';
  blockReason: string | null;
}> {
  const blocking = await hasBlockingPrecedingMarketingSignals(siteId, callId);
  if (blocking) {
    return {
      status: 'BLOCKED_PRECEDING_SIGNALS',
      blockReason: 'PRECEDING_SIGNALS_NOT_EXPORTED',
    };
  }
  return { status: 'QUEUED', blockReason: null };
}
