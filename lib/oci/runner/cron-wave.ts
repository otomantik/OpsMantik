import { adminClient } from '@/lib/supabase/admin';
import { MAX_RETRY_ATTEMPTS } from '@/lib/oci/constants';
import { bulkUpdateQueue, bulkUpdateQueueGrouped } from '@/lib/oci/runner/queue-bulk-update';
import { writeQueueDeadLetterAudit } from '@/lib/oci/runner/dead-letter';
import { syncQueueValuesFromCalls } from '@/lib/oci/runner/queue-value-sync';
import { processConversionBatch } from '@/lib/oci/runner/process-conversion-batch';
import { persistProviderOutcome } from '@/lib/oci/runner/provider-outcome';
import { logGroupOutcome } from '@/lib/oci/runner/log-helpers';
import { logInfo } from '@/lib/logging/logger';
import type { ProviderHealthRow } from '@/lib/oci/runner/db-types';
import type { QueueRow } from '@/lib/cron/process-offline-conversions';

export type CronWaveInput = {
  siteIdUuid: string;
  providerKey: string;
  siteRows: QueueRow[];
  credentials: unknown;
  prefix: string;
  writeProviderMetrics: (
    siteId: string,
    provKey: string,
    attempts: number,
    completedDelta: number,
    failedDelta: number,
    retryDelta: number
  ) => Promise<void>;
};

export type CronWaveResult = {
  completed: number;
  failed: number;
  retry: number;
};

export async function dispatchCronClaimWave(input: CronWaveInput): Promise<CronWaveResult> {
  const { siteIdUuid, providerKey, siteRows, credentials, prefix, writeProviderMetrics } = input;
  let completed = 0;
  let failed = 0;
  let retry = 0;

  const { data: healthRows } = await adminClient.rpc('get_provider_health_state', {
    p_site_id: siteIdUuid,
    p_provider_key: providerKey,
  });
  const health = (healthRows as ProviderHealthRow[] | null)?.[0] ?? null;
  const state = health?.state ?? 'CLOSED';
  const nextProbeAt = health?.next_probe_at ? new Date(health.next_probe_at).getTime() : 0;
  const probeLimit = health?.probe_limit ?? 5;

  if (state === 'OPEN') {
    if (nextProbeAt > Date.now()) {
      const jitterMs = Math.floor(Math.random() * 31 * 1000);
      const nextRetryAt = new Date(nextProbeAt + jitterMs).toISOString();
      await bulkUpdateQueueGrouped(
        siteRows,
        (r) => r.id,
        (row) => {
          const count = (row.retry_count ?? 0) + 1;
          const isFinal = count >= MAX_RETRY_ATTEMPTS;
          return isFinal
            ? {
                status: 'DEAD_LETTER_QUARANTINE' as const,
                retry_count: count,
                last_error: 'CIRCUIT_OPEN',
                updated_at: new Date().toISOString(),
                provider_error_code: 'MAX_ATTEMPTS',
                provider_error_category: 'PERMANENT' as const,
              }
            : {
                status: 'RETRY' as const,
                retry_count: count,
                next_retry_at: nextRetryAt,
                last_error: 'CIRCUIT_OPEN',
                updated_at: new Date().toISOString(),
              };
        },
        prefix,
        'Update CIRCUIT_OPEN failed'
      );
      await writeQueueDeadLetterAudit(
        siteIdUuid,
        siteRows.filter((row) => (row.retry_count ?? 0) + 1 >= MAX_RETRY_ATTEMPTS),
        'MAX_ATTEMPTS',
        'CIRCUIT_OPEN',
        'MAX_ATTEMPTS'
      );
      for (const row of siteRows) {
        const count = (row.retry_count ?? 0) + 1;
        if (count >= MAX_RETRY_ATTEMPTS) failed++;
        else retry++;
      }
      return { completed, failed, retry };
    }
    await adminClient.rpc('set_provider_state_half_open', { p_site_id: siteIdUuid, p_provider_key: providerKey });
  }

  let rowsToProcess = siteRows;
  if (state === 'HALF_OPEN') {
    const limitProbe = Math.max(1, Math.min(probeLimit, siteRows.length));
    rowsToProcess = siteRows.slice(0, limitProbe);
    const remainder = siteRows.slice(limitProbe);
    if (remainder.length > 0) {
      await bulkUpdateQueue(
        remainder.map((r) => r.id),
        { status: 'QUEUED', next_retry_at: null, updated_at: new Date().toISOString() },
        prefix,
        'Update QUEUED (HALF_OPEN remainder) failed'
      );
    }
  }

  const mismatchIds = await syncQueueValuesFromCalls(siteIdUuid, rowsToProcess, prefix);
  const failClosed = process.env.QUEUE_VALUE_MISMATCH_FAIL_CLOSED === '1';
  if (failClosed && mismatchIds.size > 0) {
    await bulkUpdateQueue(
      [...mismatchIds],
      { status: 'QUEUED', next_retry_at: null, updated_at: new Date().toISOString() },
      prefix,
      'Release mismatch rows (fail-closed cron) to QUEUED'
    );
    logInfo('QUEUE_VALUE_MISMATCH_FAIL_CLOSED', { site_id: siteIdUuid, skipped_count: mismatchIds.size, prefix });
  }

  const result = await processConversionBatch({
    siteId: siteIdUuid,
    providerKey,
    rows: rowsToProcess,
    credentials,
    prefix,
    failClosedOnMismatch: failClosed,
    mismatchIds,
  });

  completed = result.completed;
  failed = result.failed;
  retry = result.retry;
  await writeProviderMetrics(siteIdUuid, providerKey, rowsToProcess.length, completed, failed, retry);
  await persistProviderOutcome(siteIdUuid, providerKey, completed > 0, retry > 0, prefix);
  logGroupOutcome(prefix, 'cron', providerKey, rowsToProcess.length, completed, failed, retry);
  return { completed, failed, retry };
}
