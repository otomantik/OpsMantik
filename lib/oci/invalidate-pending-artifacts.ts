import { adminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging/logger';
import { applyMarketingSignalDispatchBatch } from '@/lib/oci/marketing-signal-dispatch-kernel';

export async function invalidatePendingOciArtifactsForCall(
  callId: string,
  siteId: string,
  reason: string,
  now: string
): Promise<void> {
  const [{ data: pendingSigRows }, { data: processingSigRows }, queueResult, outboxResult] = await Promise.all([
    adminClient
      .from('marketing_signals')
      .select('id')
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .eq('dispatch_status', 'PENDING'),
    adminClient
      .from('marketing_signals')
      .select('id')
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .eq('dispatch_status', 'PROCESSING'),
    adminClient
      .from('offline_conversion_queue')
      .update({
        status: 'FAILED',
        last_error: reason,
        provider_error_code: 'CALL_NOT_SENDABLE_FOR_OCI',
        provider_error_category: 'DETERMINISTIC_SKIP',
        claimed_at: null,
      })
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .in('status', ['QUEUED', 'RETRY', 'PROCESSING', 'UPLOADED']),
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

  if (queueResult.error) {
    logError('INVALIDATE_OCI_QUEUE_FAILED', { call_id: callId, site_id: siteId, reason, error: queueResult.error.message });
  }
  if (outboxResult.error) {
    logError('INVALIDATE_OCI_OUTBOX_FAILED', { call_id: callId, site_id: siteId, reason, error: outboxResult.error.message });
  }

  const pendingIds = (Array.isArray(pendingSigRows) ? pendingSigRows : []).map((r: { id: string }) => r.id);
  const processingIds = (Array.isArray(processingSigRows) ? processingSigRows : []).map((r: { id: string }) => r.id);

  try {
    if (pendingIds.length > 0) {
      await applyMarketingSignalDispatchBatch(adminClient, {
        siteId,
        signalIds: pendingIds,
        expectStatus: 'PENDING',
        newStatus: 'JUNK_ABORTED',
      });
    }
  } catch (e) {
    logError('INVALIDATE_OCI_SIGNALS_PENDING_FAILED', {
      call_id: callId,
      site_id: siteId,
      reason,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  try {
    if (processingIds.length > 0) {
      await applyMarketingSignalDispatchBatch(adminClient, {
        siteId,
        signalIds: processingIds,
        expectStatus: 'PROCESSING',
        newStatus: 'FAILED',
      });
    }
  } catch (e) {
    logError('INVALIDATE_OCI_SIGNALS_PROCESSING_FAILED', {
      call_id: callId,
      site_id: siteId,
      reason,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
