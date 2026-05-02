/**
 * Promote offline_conversion_queue rows from BLOCKED_PRECEDING_SIGNALS → QUEUED when
 * precursor marketing_signals are no longer in blocking dispatch states.
 */

import { adminClient } from '@/lib/supabase/admin';
import { hasBlockingPrecedingMarketingSignals } from '@/lib/oci/preceding-signals';

const DEFAULT_LIMIT = 200;

export async function promoteBlockedQueueRows(limit = DEFAULT_LIMIT): Promise<{
  scanned: number;
  promoted: number;
}> {
  const cap = Math.min(500, Math.max(1, limit));
  const { data: blocked, error } = await adminClient
    .from('offline_conversion_queue')
    .select('id, site_id, call_id')
    .eq('status', 'BLOCKED_PRECEDING_SIGNALS')
    .not('call_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(cap);

  if (error) {
    throw error;
  }

  const rows = Array.isArray(blocked) ? blocked : [];
  const toPromote: string[] = [];

  for (const row of rows) {
    const id = (row as { id: string }).id;
    const siteId = (row as { site_id: string }).site_id;
    const callId = (row as { call_id: string }).call_id;
    if (!callId) continue;
    const stillBlocking = await hasBlockingPrecedingMarketingSignals(siteId, callId);
    if (!stillBlocking) {
      toPromote.push(id);
    }
  }

  if (toPromote.length === 0) {
    return { scanned: rows.length, promoted: 0 };
  }

  const nowIso = new Date().toISOString();
  const { data: affected, error: rpcError } = await adminClient.rpc(
    'append_worker_transition_batch_v2',
    {
      p_queue_ids: toPromote,
      p_new_status: 'QUEUED',
      p_created_at: nowIso,
      p_error_payload: {
        clear_fields: ['block_reason', 'blocked_at'],
      },
    }
  );

  if (rpcError) {
    throw rpcError;
  }

  return {
    scanned: rows.length,
    promoted: typeof affected === 'number' ? affected : toPromote.length,
  };
}
