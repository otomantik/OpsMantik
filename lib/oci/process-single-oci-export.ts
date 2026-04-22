import { adminClient } from '@/lib/supabase/admin';
import { createTenantClient } from '@/lib/supabase/tenant-client';
import { getProvider } from '@/lib/providers/registry';
import { queueRowToConversionJob, type QueueRow } from '@/lib/cron/process-offline-conversions';
import { logInfo, logError, logWarn } from '@/lib/logging/logger';
import { buildQueueTransitionErrorPayload } from '@/lib/oci/queue-transition-ledger';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

async function decryptCredentials(ciphertext: string): Promise<unknown> {
  const vault = await import('@/lib/security/vault').catch(() => null);
  if (!vault?.decryptJson) throw new Error('Vault not configured');
  return vault.decryptJson(ciphertext);
}

/**
 * Process a single OCI export job (Value-Lane).
 * Claims, uploads, and updates the queue row atomically.
 */
export async function processSingleOciExport(queueId: string, siteId: string) {
  const prefix = `[oci-value-lane:${queueId}]`;
  
  try {
    // 1. Fetch the queue row and site sync method
    const { data: row, error: fetchErr } = await adminClient
      .from('offline_conversion_queue')
      .select('*, sites!inner(oci_sync_method), claimed_at, claimed_by')
      .eq('id', queueId)
      .eq('site_id', siteId)
      .maybeSingle();

    if (fetchErr || !row) {
      logWarn(`${prefix} Row not found or access denied`, { siteId });
      return { ok: false, error: 'ROW_NOT_FOUND' };
    }

    const qRow = row as QueueRow;
    if (qRow.status === 'COMPLETED') {
      return { ok: true, status: 'ALREADY_COMPLETED' };
    }
    if (qRow.status === 'UPLOADED' || qRow.status === 'COMPLETED_UNVERIFIED') {
      return { ok: true, status: 'ALREADY_UPLOADED' };
    }
    const claimEvidence =
      qRow.status === 'PROCESSING' &&
      Boolean((row as { claimed_at?: string | null }).claimed_at) &&
      Boolean((row as { claimed_by?: string | null }).claimed_by);
    if (!claimEvidence) {
      incrementRefactorMetric('fastpath_unclaimed_reject_total');
      logWarn(`${prefix} Unclaimed fast-path export rejected`, {
        siteId,
        queueId,
        status: qRow.status ?? null,
      });
      return { ok: false, error: 'UNCLAIMED_FASTPATH' };
    }
    const siteRaw = (row as any).sites;
    const syncMethod = siteRaw?.oci_sync_method || 'script';

    if (syncMethod !== 'api') {
      logInfo(`${prefix} Skipping Value-Lane processing (Site in ${syncMethod} mode)`);
      return { ok: true, status: 'SKIPPED_BY_SYNC_METHOD' };
    }

    const providerKey = qRow.provider_key;

    // 2. Fetch credentials
    const tenantClient = createTenantClient(siteId);
    const { data: credsData, error: credsErr } = await tenantClient
      .from('provider_credentials')
      .select('encrypted_payload')
      .eq('provider_key', providerKey)
      .eq('is_active', true)
      .maybeSingle();

    if (credsErr || !credsData?.encrypted_payload) {
      const msg = 'Credentials missing or inactive';
      await updateQueueStatus(queueId, 'FAILED', msg, 'AUTH');
      return { ok: false, error: 'AUTH_ERROR' };
    }

    // 3. Decrypt and setup adapter
    const credentials = await decryptCredentials(credsData.encrypted_payload);
    const adapter = getProvider(providerKey);
    const job = queueRowToConversionJob(qRow);

    // 4. Enrich with hashed phone if available
    if (qRow.call_id) {
       const { data: callData } = await adminClient
        .from('calls')
        .select('caller_phone_hash_sha256')
        .eq('id', qRow.call_id)
        .maybeSingle();
       
       const hash = (callData as { caller_phone_hash_sha256?: string | null })?.caller_phone_hash_sha256;
       if (hash && hash.length === 64) {
         job.payload = { ...job.payload, hashed_phone_number: hash };
       }
    }

    const batchId = crypto.randomUUID();
    const startedAt = Date.now();

    // 5. Ledger Start
    await adminClient.from('provider_upload_attempts').insert({
      site_id: siteId,
      provider_key: providerKey,
      batch_id: batchId,
      phase: 'STARTED',
      claimed_count: 1,
    });

    // 6. Execute Upload
    const [result] = await adapter.uploadConversions({ jobs: [job], credentials });

    const durationMs = Date.now() - startedAt;

    // 7. Persist Results
    if (result.status === 'COMPLETED') {
      await adminClient.rpc('append_worker_transition_batch_v2', {
        p_queue_ids: [queueId],
        p_new_status: 'COMPLETED',
        p_created_at: new Date().toISOString(),
        p_error_payload: {
          last_error: null,
          uploaded_at: new Date().toISOString(),
          provider_request_id: result.provider_request_id,
          provider_ref: result.provider_ref
        }
      });
      
      logInfo(`${prefix} Successfully uploaded to ${providerKey}`, { durationMs });
    } else {
      const payload = buildQueueTransitionErrorPayload({
        last_error: result.error_message || 'Unknown error',
        provider_error_code: result.error_code ?? undefined,
        provider_error_category: result.provider_error_category ?? undefined,
        attempt_count: (qRow.retry_count ?? 0) + 1,
        retry_count: (qRow.retry_count ?? 0) + 1,
      });

      await adminClient.rpc('append_worker_transition_batch_v2', {
        p_queue_ids: [queueId],
        p_new_status: result.status,
        p_created_at: new Date().toISOString(),
        p_error_payload: payload
      });

      logWarn(`${prefix} Upload failed with ${result.status}`, { error: result.error_message });
    }

    // 8. Finished Ledger
    await adminClient.from('provider_upload_attempts').insert({
      site_id: siteId,
      provider_key: providerKey,
      batch_id: batchId,
      phase: 'FINISHED',
      claimed_count: 1,
      completed_count: result.status === 'COMPLETED' ? 1 : 0,
      failed_count: result.status === 'FAILED' ? 1 : 0,
      retry_count: result.status === 'RETRY' ? 1 : 0,
      duration_ms: durationMs,
      error_code: result.error_code || null,
      error_category: result.provider_error_category || null,
    });

    return { ok: true, status: result.status };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`${prefix} Value-Lane processing failed`, { error: msg });
    return { ok: false, error: msg };
  }
}

async function updateQueueStatus(id: string, status: string, error: string, category: string) {
  await adminClient.rpc('append_worker_transition_batch_v2', {
    p_queue_ids: [id],
    p_new_status: status,
    p_created_at: new Date().toISOString(),
    p_error_payload: {
      last_error: error,
      provider_error_code: category,
      provider_error_category: category,
    }
  });
}
