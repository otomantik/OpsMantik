import { adminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging/logger';
import type { ExportAuthContext } from './export-auth';
import type { BuiltExportData } from './export-build-items';

export async function markExportProcessing(ctx: ExportAuthContext, built: BuiltExportData): Promise<void> {
  if (!ctx.markAsExported) return;

  const now = new Date().toISOString();
  const idsToMarkProcessing = built.keptConversions.map((item) => item.id.replace('seal_', ''));
  const signalIdsToMarkProcessing = built.keptSignalItems.map((item) => item.id.replace('signal_', ''));

  if (idsToMarkProcessing.length > 0) {
    const { data: claimedCount, error: rpcError } = await adminClient.rpc(
      'append_script_claim_transition_batch',
      { p_queue_ids: idsToMarkProcessing, p_claimed_at: now }
    );
    if (rpcError || typeof claimedCount !== 'number' || claimedCount !== idsToMarkProcessing.length) {
      logError('OCI_GOOGLE_ADS_EXPORT_CLAIM_FAILED', { code: (rpcError as { code?: string })?.code });
      throw new Error('QUEUE_CLAIM_MISMATCH');
    }
  }

  if (built.suppressedQueueIds.length > 0) {
    const { data: claimedCount, error: claimError } = await adminClient.rpc(
      'append_script_claim_transition_batch',
      { p_queue_ids: built.suppressedQueueIds, p_claimed_at: now }
    );
    if (claimError || typeof claimedCount !== 'number' || claimedCount !== built.suppressedQueueIds.length) {
      throw new Error('QUEUE_CLAIM_MISMATCH');
    }
    const { data: updatedCount, error: updateError } = await adminClient.rpc('append_script_transition_batch', {
      p_queue_ids: built.suppressedQueueIds,
      p_new_status: 'COMPLETED',
      p_created_at: now,
      p_error_payload: {
        uploaded_at: now,
        last_error: 'SUPPRESSED_BY_HIGHER_GEAR',
        provider_error_code: 'SUPPRESSED_BY_HIGHER_GEAR',
        provider_error_category: 'DETERMINISTIC_SKIP',
        clear_fields: ['next_retry_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
      },
    });
    if (updateError || typeof updatedCount !== 'number') {
      throw new Error('SERVER_ERROR');
    }
  }

  if (signalIdsToMarkProcessing.length > 0) {
    const { data, error } = await adminClient
      .from('marketing_signals')
      .update({ dispatch_status: 'PROCESSING' })
      .in('id', signalIdsToMarkProcessing)
      .eq('site_id', ctx.siteUuid)
      .eq('dispatch_status', 'PENDING')
      .select('id');
    const updatedSignals = Array.isArray(data) ? data.length : 0;
    if (error || updatedSignals !== signalIdsToMarkProcessing.length) throw new Error('SIGNAL_CLAIM_MISMATCH');
  }

  if (built.suppressedSignalIds.length > 0) {
    const { data, error } = await adminClient
      .from('marketing_signals')
      .update({ dispatch_status: 'JUNK_ABORTED' })
      .in('id', built.suppressedSignalIds)
      .eq('site_id', ctx.siteUuid)
      .eq('dispatch_status', 'PENDING')
      .select('id');
    const updated = Array.isArray(data) ? data.length : 0;
    if (error || updated !== built.suppressedSignalIds.length) throw new Error('SIGNAL_STATE_MISMATCH');
  }
}
