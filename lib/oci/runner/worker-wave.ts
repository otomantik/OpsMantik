import { adminClient } from '@/lib/supabase/admin';
import {
  acquireSemaphore,
  globalProviderKey,
  releaseSemaphore,
  siteProviderKey,
} from '@/lib/providers/limits/semaphore';
import { bulkUpdateQueue } from '@/lib/oci/runner/queue-bulk-update';
import { syncQueueValuesFromCalls } from '@/lib/oci/runner/queue-value-sync';
import { processConversionBatch } from '@/lib/oci/runner/process-conversion-batch';
import { persistProviderOutcome } from '@/lib/oci/runner/provider-outcome';
import { logGroupOutcome } from '@/lib/oci/runner/log-helpers';
import { logInfo } from '@/lib/logging/logger';
import type {
  UploadAttemptFinishedInsert,
  UploadAttemptStartedInsert,
} from '@/lib/oci/runner/db-types';
import type { QueueRow } from '@/lib/cron/process-offline-conversions';

export type WorkerWaveInput = {
  siteIdUuid: string;
  providerKey: string;
  siteRows: QueueRow[];
  credentials: unknown;
  prefix: string;
};

export type WorkerWaveResult = {
  completed: number;
  failed: number;
  retry: number;
};

export async function dispatchWorkerWave(input: WorkerWaveInput): Promise<WorkerWaveResult> {
  const { siteIdUuid, providerKey, siteRows, credentials, prefix } = input;
  const limitSite = Math.max(1, parseInt(process.env.CONCURRENCY_PER_SITE_PROVIDER ?? '2', 10) || 2);
  const globalLimit = Math.max(0, parseInt(process.env.CONCURRENCY_GLOBAL_PER_PROVIDER ?? '10', 10));
  const ttlMs = Math.max(60000, parseInt(process.env.SEMAPHORE_TTL_MS ?? '120000', 10) || 120000);
  const siteKey = siteProviderKey(siteIdUuid, providerKey);
  const globalKey = globalProviderKey(providerKey);

  let siteToken: string | null = await acquireSemaphore(siteKey, limitSite, ttlMs);
  if (!siteToken) {
    await markConcurrencyRetry(siteIdUuid, providerKey, siteRows, prefix);
    return { completed: 0, failed: 0, retry: siteRows.length };
  }

  let globalToken: string | null = null;
  if (globalLimit > 0) {
    globalToken = await acquireSemaphore(globalKey, globalLimit, ttlMs);
    if (!globalToken) {
      await releaseSemaphore(siteKey, siteToken);
      siteToken = null;
      await markConcurrencyRetry(siteIdUuid, providerKey, siteRows, prefix);
      return { completed: 0, failed: 0, retry: siteRows.length };
    }
  }

  try {
    const mismatchIds = await syncQueueValuesFromCalls(siteIdUuid, siteRows, prefix);
    const failClosed = process.env.QUEUE_VALUE_MISMATCH_FAIL_CLOSED === '1';
    if (failClosed && mismatchIds.size > 0) {
      await bulkUpdateQueue(
        [...mismatchIds],
        { status: 'QUEUED', next_retry_at: null, updated_at: new Date().toISOString() },
        prefix,
        'Release mismatch rows (fail-closed) to QUEUED'
      );
      logInfo('QUEUE_VALUE_MISMATCH_FAIL_CLOSED', { site_id: siteIdUuid, skipped_count: mismatchIds.size, prefix });
    }

    const batchId = crypto.randomUUID();
    const startedAt = Date.now();
    await adminClient.from('provider_upload_attempts').insert({
      site_id: siteIdUuid,
      provider_key: providerKey,
      batch_id: batchId,
      phase: 'STARTED',
      claimed_count: siteRows.length,
    } as UploadAttemptStartedInsert);

    const result = await processConversionBatch({
      siteId: siteIdUuid,
      providerKey,
      rows: siteRows,
      credentials,
      prefix,
      failClosedOnMismatch: failClosed,
      mismatchIds,
    });

    const durationMs = Date.now() - startedAt;
    await adminClient.from('provider_upload_attempts').insert({
      site_id: siteIdUuid,
      provider_key: providerKey,
      batch_id: batchId,
      phase: 'FINISHED',
      claimed_count: siteRows.length,
      completed_count: result.completed,
      failed_count: result.failed,
      retry_count: result.retry,
      duration_ms: durationMs,
      provider_request_id: result.providerRequestId,
      error_code: result.errorCode,
      error_category: result.errorCategory,
    } as UploadAttemptFinishedInsert);

    const isTransient = result.retry > 0 || result.errorCategory === 'TRANSIENT';
    await persistProviderOutcome(siteIdUuid, providerKey, result.completed > 0, isTransient, prefix);
    logGroupOutcome(prefix, 'worker', providerKey, siteRows.length, result.completed, result.failed, result.retry);
    return { completed: result.completed, failed: result.failed, retry: result.retry };
  } finally {
    if (siteToken) await releaseSemaphore(siteKey, siteToken);
    if (globalToken) await releaseSemaphore(globalKey, globalToken);
  }
}

async function markConcurrencyRetry(
  siteIdUuid: string,
  providerKey: string,
  siteRows: QueueRow[],
  prefix: string
): Promise<void> {
  const backoffSec = 30 + Math.floor(Math.random() * 11);
  const nextRetryAt = new Date(Date.now() + backoffSec * 1000).toISOString();
  const lastError = 'CONCURRENCY_LIMIT: Semaphore full';

  await bulkUpdateQueue(
    siteRows.map((r) => r.id),
    {
      status: 'RETRY',
      next_retry_at: nextRetryAt,
      last_error: lastError,
      updated_at: new Date().toISOString(),
      provider_error_code: 'CONCURRENCY_LIMIT',
      provider_error_category: 'TRANSIENT',
    },
    prefix,
    'Update RETRY (concurrency) failed'
  );

  const batchIdConv = crypto.randomUUID();
  const startedAtConv = Date.now();
  await adminClient.from('provider_upload_attempts').insert({
    site_id: siteIdUuid,
    provider_key: providerKey,
    batch_id: batchIdConv,
    phase: 'STARTED',
    claimed_count: siteRows.length,
  } as UploadAttemptStartedInsert);

  await adminClient.from('provider_upload_attempts').insert({
    site_id: siteIdUuid,
    provider_key: providerKey,
    batch_id: batchIdConv,
    phase: 'FINISHED',
    claimed_count: siteRows.length,
    completed_count: 0,
    failed_count: 0,
    retry_count: siteRows.length,
    duration_ms: Date.now() - startedAtConv,
    error_code: 'CONCURRENCY_LIMIT',
    error_category: 'TRANSIENT',
  } as UploadAttemptFinishedInsert);

  await persistProviderOutcome(siteIdUuid, providerKey, false, true, prefix);
  logGroupOutcome(prefix, 'worker', providerKey, siteRows.length, 0, 0, siteRows.length);
}
