/**
 * Runner queue bulk-update — batched queue transition writes.
 * Extracted from lib/oci/runner.ts during Phase 4 god-object split.
 */

import { adminClient } from '@/lib/supabase/admin';
import { logInfo } from '@/lib/logging/logger';
import { chunkArray } from '@/lib/utils/batch';
import {
  buildQueueTransitionErrorPayload,
  type QueueSnapshotUpdatePayload,
} from '@/lib/oci/queue-transition-ledger';
import { logRunnerError } from './log-helpers';

export function buildWorkerBatchErrorPayload(
  payload: QueueSnapshotUpdatePayload
): Record<string, unknown> | null {
  const clearFields: Array<
    'last_error' |
    'provider_error_code' |
    'provider_error_category' |
    'next_retry_at' |
    'uploaded_at' |
    'claimed_at' |
    'provider_request_id' |
    'provider_ref'
  > = [];

  const maybeClear = (field: typeof clearFields[number], value: unknown): void => {
    if (value === null) clearFields.push(field);
  };

  maybeClear('last_error', payload.last_error);
  maybeClear('provider_error_code', payload.provider_error_code);
  maybeClear('provider_error_category', payload.provider_error_category);
  maybeClear('next_retry_at', payload.next_retry_at);
  maybeClear('uploaded_at', payload.uploaded_at);
  maybeClear('claimed_at', payload.claimed_at);
  maybeClear('provider_request_id', payload.provider_request_id);
  maybeClear('provider_ref', payload.provider_ref);

  return buildQueueTransitionErrorPayload({
    last_error: payload.last_error ?? undefined,
    provider_error_code: payload.provider_error_code ?? undefined,
    provider_error_category: payload.provider_error_category ?? undefined,
    attempt_count: payload.attempt_count ?? undefined,
    retry_count: payload.retry_count ?? undefined,
    next_retry_at: payload.next_retry_at ?? undefined,
    uploaded_at: payload.uploaded_at ?? undefined,
    claimed_at: payload.claimed_at ?? undefined,
    provider_request_id: payload.provider_request_id ?? undefined,
    provider_ref: payload.provider_ref ?? undefined,
    clear_fields: clearFields,
  });
}

/** Bulk append queue transitions by ids. Reduces O(N) round-trips to O(N/500). */
export async function bulkUpdateQueue(
  ids: string[],
  payload: QueueSnapshotUpdatePayload,
  prefix: string,
  logLabel: string
): Promise<void> {
  const chunks = chunkArray(ids, 500);
  const start = Date.now();
  const failures: string[] = [];
  for (const chunk of chunks) {
    try {
      const { data, error } = await adminClient.rpc('append_worker_transition_batch_v2', {
        p_queue_ids: chunk,
        p_new_status: payload.status,
        p_created_at: payload.updated_at ?? new Date().toISOString(),
        p_error_payload: buildWorkerBatchErrorPayload(payload),
      });
      if (error || typeof data !== 'number' || data !== chunk.length) {
        throw new Error(
          error?.message ??
          `append_worker_transition_batch_v2 count mismatch: requested=${chunk.length} updated=${String(data)}`
        );
      }
    } catch (error) {
      logRunnerError(prefix, logLabel, error);
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  const durationMs = Date.now() - start;
  if (ids.length > 0) {
    logInfo('OCI_BULK_LEDGER_APPEND', { idsCount: ids.length, chunks: chunks.length, durationMs, prefix });
  }
  if (failures.length > 0) {
    throw new Error(`${logLabel}: ${failures.length} chunk(s) failed: ${failures.join(' | ')}`);
  }
}

/** Group rows by identical transition payload; bulk append each group. */
export async function bulkUpdateQueueGrouped<T>(
  rows: T[],
  idFn: (r: T) => string,
  payloadFn: (r: T) => QueueSnapshotUpdatePayload,
  prefix: string,
  logLabel: string
): Promise<void> {
  const byKey = new Map<string, { payload: QueueSnapshotUpdatePayload; ids: string[] }>();
  for (const row of rows) {
    const payload = payloadFn(row);
    const key = JSON.stringify(payload);
    const existing = byKey.get(key);
    if (existing) existing.ids.push(idFn(row));
    else byKey.set(key, { payload, ids: [idFn(row)] });
  }
  for (const { payload, ids } of byKey.values()) {
    await bulkUpdateQueue(ids, payload, prefix, logLabel);
  }
}
