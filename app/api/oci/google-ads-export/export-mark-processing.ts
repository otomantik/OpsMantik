import { adminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging/logger';
import { applyMarketingSignalDispatchBatch } from '@/lib/oci/marketing-signal-dispatch-kernel';
import type { ExportAuthContext } from './export-auth';
import type { BuiltExportData } from './export-build-items';

async function claimAndFinalizeQueue(
  ids: string[],
  now: string,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  if (ids.length === 0) return;
  const { data: claimedCount, error: claimError } = await adminClient.rpc(
    'append_script_claim_transition_batch',
    { p_queue_ids: ids, p_claimed_at: now }
  );
  if (claimError || typeof claimedCount !== 'number' || claimedCount !== ids.length) {
    throw new Error('QUEUE_CLAIM_MISMATCH');
  }
  const { data: updatedCount, error: updateError } = await adminClient.rpc('append_script_transition_batch', {
    p_queue_ids: ids,
    p_new_status: 'FAILED',
    p_created_at: now,
    p_error_payload: {
      last_error: errorMessage,
      provider_error_code: errorCode,
      provider_error_category: 'DETERMINISTIC_SKIP',
      clear_fields: ['next_retry_at', 'uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
    },
  });
  if (updateError || typeof updatedCount !== 'number') {
    throw new Error('SERVER_ERROR');
  }
}

async function markSignalsDeterministicSkip(
  siteId: string,
  signalIds: string[],
  code: 'INVALID_CONVERSION_TIME' | 'VALUE_ZERO' | 'UNKNOWN_STAGE'
): Promise<void> {
  if (signalIds.length === 0) return;
  const updated = await applyMarketingSignalDispatchBatch(adminClient, {
    siteId,
    signalIds,
    expectStatus: 'PENDING',
    newStatus: 'FAILED',
  });
  if (updated !== signalIds.length) throw new Error('SIGNAL_STATE_MISMATCH');
  logError('OCI_SIGNAL_EXPORT_GATE_FAILED', { site_id: siteId, code, count: signalIds.length });
}

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

  if (built.blockedQueueIds.length > 0) {
    await claimAndFinalizeQueue(
      built.blockedQueueIds,
      now,
      'CALL_NOT_SENDABLE_FOR_OCI',
      'CALL_NOT_SENDABLE_FOR_OCI'
    );
  }

  if (built.blockedExportGateIds.length > 0) {
    await claimAndFinalizeQueue(
      built.blockedExportGateIds,
      now,
      'OCI_EXPORT_GATE',
      'OCI_EXPORT_GATE:CALL_ID_REQUIRED_FOR_INTENT_TIME_SSOT'
    );
  }

  if (built.blockedQueueTimeIds.length > 0) {
    await claimAndFinalizeQueue(
      built.blockedQueueTimeIds,
      now,
      'INVALID_CONVERSION_TIME',
      'INVALID_CONVERSION_TIME'
    );
  }

  if (built.blockedValueZeroIds.length > 0 || built.blockedExpiredIds.length > 0) {
    await claimAndFinalizeQueue(
      [...built.blockedValueZeroIds, ...built.blockedExpiredIds],
      now,
      'VALUE_ZERO',
      'VALUE_ZERO'
    );
  }

  if (signalIdsToMarkProcessing.length > 0) {
    const updatedSignals = await applyMarketingSignalDispatchBatch(adminClient, {
      siteId: ctx.siteUuid,
      signalIds: signalIdsToMarkProcessing,
      expectStatus: 'PENDING',
      newStatus: 'PROCESSING',
    });
    if (updatedSignals !== signalIdsToMarkProcessing.length) throw new Error('SIGNAL_CLAIM_MISMATCH');
  }

  if (built.suppressedSignalIds.length > 0) {
    const updated = await applyMarketingSignalDispatchBatch(adminClient, {
      siteId: ctx.siteUuid,
      signalIds: built.suppressedSignalIds,
      expectStatus: 'PENDING',
      newStatus: 'JUNK_ABORTED',
    });
    if (updated !== built.suppressedSignalIds.length) throw new Error('SIGNAL_STATE_MISMATCH');
  }

  await markSignalsDeterministicSkip(ctx.siteUuid, built.blockedSignalIds, 'UNKNOWN_STAGE');
  await markSignalsDeterministicSkip(ctx.siteUuid, built.blockedSignalTimeIds, 'INVALID_CONVERSION_TIME');
  await markSignalsDeterministicSkip(ctx.siteUuid, built.blockedSignalValueIds, 'VALUE_ZERO');
}
