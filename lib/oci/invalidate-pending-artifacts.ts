import { adminClient } from '@/lib/supabase/admin';
import { logError, logInfo } from '@/lib/logging/logger';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

/**
 * On call-level reversal (e.g. junk), fail in-flight queue rows and outbox without
 * bypassing the oci_queue_transitions ledger.
 */
export async function invalidatePendingOciArtifactsForCall(
  callId: string,
  siteId: string,
  reason: string,
  now: string
): Promise<void> {
  const { data: pendingRows, error: queueSelectError } = await adminClient
    .from('offline_conversion_queue')
    .select('id, status')
    .eq('site_id', siteId)
    .eq('call_id', callId)
    .in('status', ['QUEUED', 'RETRY', 'PROCESSING', 'UPLOADED', 'BLOCKED_PRECEDING_SIGNALS']);

  if (queueSelectError) {
    logError('INVALIDATE_OCI_QUEUE_SELECT_FAILED', {
      call_id: callId,
      site_id: siteId,
      reason,
      error: queueSelectError.message,
    });
  }

  const queueRows =
    !queueSelectError && Array.isArray(pendingRows)
      ? (pendingRows as Array<{ id?: string | null; status?: string | null }>)
      : [];
  const queueIds = queueRows
    .map((r) => r.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const blockedPrecedingCount = queueRows.filter((r) => r.status === 'BLOCKED_PRECEDING_SIGNALS').length;

  const [queueRpcResult, outboxResult] = await Promise.all([
    (async () => {
      if (queueIds.length === 0) {
        return { data: null as number | null, error: null as { message?: string } | null };
      }
      return adminClient.rpc('append_worker_transition_batch_v2', {
        p_queue_ids: queueIds,
        p_new_status: 'FAILED',
        p_created_at: now,
        p_error_payload: {
          last_error: reason,
          provider_error_code: 'CALL_NOT_SENDABLE_FOR_OCI',
          provider_error_category: 'DETERMINISTIC_SKIP',
          clear_fields: [
            'next_retry_at',
            'uploaded_at',
            'claimed_at',
            'provider_request_id',
            'provider_ref',
            'block_reason',
            'blocked_at',
          ],
        },
      });
    })(),
    adminClient
      .from('outbox_events')
      .update({
        status: 'FAILED',
        last_error: reason,
        processed_at: now,
      })
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .in('status', ['PENDING', 'PROCESSING']),
  ]);

  if (queueIds.length > 0) {
    const { data: affected, error: rpcErr } = queueRpcResult;
    if (rpcErr || typeof affected !== 'number' || affected !== queueIds.length) {
      logError('INVALIDATE_OCI_QUEUE_RPC_FAILED', {
        call_id: callId,
        site_id: siteId,
        reason,
        requested: queueIds.length,
        affected: typeof affected === 'number' ? affected : null,
        error: rpcErr?.message ?? (typeof affected !== 'number' ? 'non-number rpc result' : 'count mismatch'),
      });
    } else if (blockedPrecedingCount > 0) {
      incrementRefactorMetric('oci_invalidation_blocked_preceding_terminalized_total', blockedPrecedingCount);
      logInfo('OCI_INVALIDATION_BLOCKED_PRECEDING_TERMINALIZED', {
        site_id: siteId,
        reason_group: 'OCI_INVALIDATION_BLOCKED_PRECEDING_TERMINALIZED',
        blocked_preceding_count: blockedPrecedingCount,
        total_invalidated: queueIds.length,
      });
    }
  }

  if (outboxResult.error) {
    logError('INVALIDATE_OCI_OUTBOX_FAILED', {
      call_id: callId,
      site_id: siteId,
      reason,
      error: outboxResult.error.message,
    });
  }
}
