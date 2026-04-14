import { adminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging/logger';

export async function invalidatePendingOciArtifactsForCall(
  callId: string,
  siteId: string,
  reason: string,
  now: string
): Promise<void> {
  const [queueResult, outboxResult, signalPendingResult, signalProcessingResult] = await Promise.all([
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
    adminClient
      .from('marketing_signals')
      .update({
        dispatch_status: 'JUNK_ABORTED',
      })
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .eq('dispatch_status', 'PENDING'),
    adminClient
      .from('marketing_signals')
      .update({
        dispatch_status: 'FAILED',
      })
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .eq('dispatch_status', 'PROCESSING'),
  ]);

  if (queueResult.error) {
    logError('INVALIDATE_OCI_QUEUE_FAILED', { call_id: callId, site_id: siteId, reason, error: queueResult.error.message });
  }
  if (outboxResult.error) {
    logError('INVALIDATE_OCI_OUTBOX_FAILED', { call_id: callId, site_id: siteId, reason, error: outboxResult.error.message });
  }
  if (signalPendingResult.error) {
    logError('INVALIDATE_OCI_SIGNALS_PENDING_FAILED', { call_id: callId, site_id: siteId, reason, error: signalPendingResult.error.message });
  }
  if (signalProcessingResult.error) {
    logError('INVALIDATE_OCI_SIGNALS_PROCESSING_FAILED', { call_id: callId, site_id: siteId, reason, error: signalProcessingResult.error.message });
  }
}
