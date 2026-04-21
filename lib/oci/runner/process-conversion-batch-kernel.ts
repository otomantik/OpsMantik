import { adminClient } from '@/lib/supabase/admin';
import { getProvider } from '@/lib/providers/registry';
import type { UploadResult } from '@/lib/providers/types';
import {
  nextRetryDelaySeconds,
  queueRowToConversionJob,
  type QueueRow,
} from '@/lib/cron/process-offline-conversions';
import { MAX_RETRY_ATTEMPTS } from '@/lib/oci/constants';
import type { QueueSnapshotUpdatePayload } from '@/lib/oci/queue-transition-ledger';
import { logWarn } from '@/lib/logging/logger';
import { bulkUpdateQueue, bulkUpdateQueueGrouped } from '@/lib/oci/runner/queue-bulk-update';
import { writeQueueDeadLetterAudit } from '@/lib/oci/runner/dead-letter';
import { logRunnerError } from '@/lib/oci/runner/log-helpers';
import { addSecondsIso, getDbNowIso } from '@/lib/time/db-now';
import type { CallPhoneHashRow } from './db-types';
import { ConversionBatchArena } from './soa-arena';
import type { ProcessBatchInput, ProcessBatchResult } from './process-conversion-batch-contract';

export async function processConversionBatchKernel(input: ProcessBatchInput): Promise<ProcessBatchResult> {
  const { siteId, providerKey, rows, credentials, prefix, failClosedOnMismatch, mismatchIds } = input;
  const dbNowIso = await getDbNowIso();
  const arena = new ConversionBatchArena(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i].value_cents as unknown;
    arena.setValueCents(i, typeof raw === 'number' ? raw : Number(raw));
    arena.setRetryCount(i, rows[i].retry_count ?? 0);
    arena.setUpdatedAtMs(i, new Date(dbNowIso).getTime());
    arena.setStatus(i, 0);
  }

  let completed = 0;
  let failed = 0;
  let retry = 0;
  let providerRequestId: string | null = null;
  let errorCode: string | null = null;
  let errorCategory: string | null = null;

  const blockedValueZeroIds: string[] = [];
  const rowsWithValue: QueueRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (failClosedOnMismatch && mismatchIds.has(row.id)) continue;
    const raw = row.value_cents as unknown;
    const v = typeof raw === 'number' ? raw : Number(raw);
    if (raw == null || raw === undefined) {
      logWarn('OCI_ROW_SKIP_NULL_VALUE', { queue_id: row.id, prefix });
      blockedValueZeroIds.push(row.id);
      continue;
    }
    if (!Number.isFinite(v) || v <= 0) {
      logWarn('OCI_ROW_SKIP_VALUE_ZERO', { queue_id: row.id, prefix, raw_value_cents: raw ?? null });
      blockedValueZeroIds.push(row.id);
      continue;
    }
    row.value_cents = v;
    rowsWithValue.push(row);
  }

  if (blockedValueZeroIds.length > 0) {
    await bulkUpdateQueue(
      blockedValueZeroIds,
      {
        status: 'FAILED',
        last_error: 'VALUE_ZERO',
        provider_error_code: 'VALUE_ZERO',
        provider_error_category: 'PERMANENT',
        updated_at: dbNowIso,
      },
      prefix,
      'Mark value_cents<=0 rows FAILED'
    );
  }

  const jobs: ReturnType<typeof queueRowToConversionJob>[] = [];
  const poisonIds: string[] = [];
  for (let i = 0; i < rowsWithValue.length; i++) {
    const row = rowsWithValue[i];
    try {
      jobs.push(queueRowToConversionJob(row));
    } catch (err) {
      logRunnerError(prefix, 'queueRowToConversionJob poison pill (row isolated)', err);
      poisonIds.push(row.id);
    }
  }

  if (poisonIds.length > 0) {
    const poisonById: Record<string, 1> = Object.create(null);
    for (let i = 0; i < poisonIds.length; i++) poisonById[poisonIds[i]] = 1;
    const poisonRows: QueueRow[] = [];
    for (let i = 0; i < rowsWithValue.length; i++) {
      const row = rowsWithValue[i];
      if (poisonById[row.id] === 1) poisonRows.push(row);
    }
    await bulkUpdateQueue(
      poisonIds,
      {
        status: 'DEAD_LETTER_QUARANTINE',
        last_error: 'POISON_PILL: Malformed payload or conversion_time',
        provider_error_code: 'POISON_PILL',
        provider_error_category: 'PERMANENT',
        updated_at: dbNowIso,
      },
      prefix,
      'Mark poison pill rows DEAD_LETTER'
    );
    await writeQueueDeadLetterAudit(
      siteId,
      poisonRows,
      'POISON_PILL',
      'POISON_PILL: Malformed payload or conversion_time',
      'PERMANENT'
    );
  }

  const callIds: string[] = [];
  const seenCallIds: Record<string, 1> = Object.create(null);
  for (let i = 0; i < rowsWithValue.length; i++) {
    const callId = rowsWithValue[i].call_id;
    if (!callId || seenCallIds[callId] === 1) continue;
    seenCallIds[callId] = 1;
    callIds.push(callId);
  }
  if (callIds.length > 0 && jobs.length > 0) {
    try {
      const rowByJobId: Record<string, QueueRow> = Object.create(null);
      for (let i = 0; i < rowsWithValue.length; i++) rowByJobId[rowsWithValue[i].id] = rowsWithValue[i];
      const { data: callsData } = await adminClient
        .from('calls')
        .select('id, caller_phone_hash_sha256')
        .in('id', callIds);
      const hashByCallId: Record<string, string> = Object.create(null);
      for (const c of (callsData ?? []) as CallPhoneHashRow[]) {
        if (c.caller_phone_hash_sha256 && typeof c.caller_phone_hash_sha256 === 'string' && c.caller_phone_hash_sha256.trim().length === 64) {
          hashByCallId[c.id] = c.caller_phone_hash_sha256.trim();
        }
      }
      for (let i = 0; i < jobs.length; i++) {
        const row = rowByJobId[jobs[i].id];
        if (!row) continue;
        const hashedPhone = row.call_id ? hashByCallId[row.call_id] : null;
        if (hashedPhone) {
          const payload = jobs[i].payload as Record<string, unknown> | null | undefined;
          if (payload && typeof payload === 'object') payload.hashed_phone_number = hashedPhone;
          else jobs[i].payload = { hashed_phone_number: hashedPhone };
        }
      }
    } catch (enrichErr) {
      logWarn('OCI_PHONE_HASH_ENRICHMENT_FAILED', {
        site_id: siteId,
        prefix,
        error: enrichErr instanceof Error ? enrichErr.message : String(enrichErr),
      });
    }
  }

  if (jobs.length === 0) {
    return { completed, failed, retry, poisonIds, blockedValueIds: blockedValueZeroIds, uploadResults: undefined, providerRequestId, errorCode, errorCategory };
  }

  const adapter = getProvider(providerKey);
  let uploadResults: UploadResult[] | undefined;
  try {
    uploadResults = await adapter.uploadConversions({ jobs, credentials });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logRunnerError(prefix, 'Adapter uploadConversions threw', err);
    errorCategory = 'TRANSIENT';
    const poisonById: Record<string, 1> = Object.create(null);
    for (let i = 0; i < poisonIds.length; i++) poisonById[poisonIds[i]] = 1;
    const rowsToRetry: QueueRow[] = [];
    const rowsToDeadLetter: QueueRow[] = [];
    for (let i = 0; i < rowsWithValue.length; i++) {
      const row = rowsWithValue[i];
      if (poisonById[row.id] === 1) continue;
      rowsToRetry.push(row);
      if ((row.retry_count ?? 0) + 1 >= MAX_RETRY_ATTEMPTS) rowsToDeadLetter.push(row);
    }
    await bulkUpdateQueueGrouped(
      rowsToRetry,
      (r) => r.id,
      (row): QueueSnapshotUpdatePayload => {
        const count = (row.retry_count ?? 0) + 1;
        const isFinal = count >= MAX_RETRY_ATTEMPTS;
        const delaySec = nextRetryDelaySeconds(row.retry_count ?? 0);
        const lastErrorFinal = isFinal ? `Max retries reached: ${msg}`.slice(0, 1000) : msg.slice(0, 1000);
        return isFinal
          ? {
            status: 'DEAD_LETTER_QUARANTINE' as const,
            retry_count: count,
            last_error: lastErrorFinal,
            updated_at: dbNowIso,
            provider_error_code: 'MAX_ATTEMPTS',
            provider_error_category: 'PERMANENT' as const,
          }
          : {
            status: 'RETRY' as const,
            retry_count: count,
            next_retry_at: addSecondsIso(dbNowIso, delaySec),
            last_error: lastErrorFinal,
            updated_at: dbNowIso,
            provider_error_code: null,
            provider_error_category: 'TRANSIENT' as const,
          };
      },
      prefix,
      'Update RETRY/DEAD_LETTER after adapter throw'
    );
    await writeQueueDeadLetterAudit(siteId, rowsToDeadLetter, 'MAX_ATTEMPTS', msg, 'MAX_ATTEMPTS');
    for (let i = 0; i < rowsToRetry.length; i++) {
      const count = (rowsToRetry[i].retry_count ?? 0) + 1;
      if (count >= MAX_RETRY_ATTEMPTS) failed++;
      else retry++;
    }
    failed += poisonIds.length;
    return {
      completed,
      failed,
      retry,
      poisonIds,
      blockedValueIds: blockedValueZeroIds,
      uploadResults: undefined,
      providerRequestId,
      errorCode,
      errorCategory,
    };
  }

  const rowById: Record<string, QueueRow> = Object.create(null);
  for (let i = 0; i < rowsWithValue.length; i++) rowById[rowsWithValue[i].id] = rowsWithValue[i];
  const matchedRows: QueueRow[] = [];
  const matchedResults: UploadResult[] = [];
  for (let i = 0; i < uploadResults.length; i++) {
    const result = uploadResults[i];
    const row = rowById[result.job_id];
    if (!row) continue;
    matchedRows.push(row);
    matchedResults.push(result);
  }

  const deadLetterRows: QueueRow[] = [];
  for (let i = 0; i < matchedRows.length; i++) {
    const row = matchedRows[i];
    const result = matchedResults[i];
    if (result.status === 'RETRY' && (row.retry_count ?? 0) + 1 >= MAX_RETRY_ATTEMPTS) deadLetterRows.push(row);
  }

  const matchedUpdates: { row: QueueRow; result: UploadResult }[] = [];
  for (let i = 0; i < matchedRows.length; i++) matchedUpdates.push({ row: matchedRows[i], result: matchedResults[i] });

  await bulkUpdateQueueGrouped(
    matchedUpdates,
    (u) => u.row.id,
    ({ row, result }): QueueSnapshotUpdatePayload => {
      if (result.status === 'COMPLETED') {
        if (result.provider_request_id && providerRequestId == null) providerRequestId = result.provider_request_id;
        const payload: QueueSnapshotUpdatePayload = {
          status: 'COMPLETED',
          last_error: null,
          updated_at: dbNowIso,
          uploaded_at: dbNowIso,
          provider_request_id: result.provider_request_id ?? null,
          provider_error_code: null,
          provider_error_category: null,
        };
        if (result.provider_ref != null) payload.provider_ref = result.provider_ref;
        return payload;
      }
      const count = (row.retry_count ?? 0) + 1;
      const maxAttemptsHit = count >= MAX_RETRY_ATTEMPTS;
      const isFatal = maxAttemptsHit || result.provider_error_category === 'VALIDATION' || result.provider_error_category === 'AUTH';
      const delaySec = nextRetryDelaySeconds(count);
      const errorMsg = result.error_message ?? 'Unknown error';
      const lastErrorFinal = isFatal ? `FINAL: ${errorMsg}`.slice(0, 1000) : errorMsg.slice(0, 1000);
      return isFatal
        ? {
          status: maxAttemptsHit ? 'DEAD_LETTER_QUARANTINE' as const : 'FAILED' as const,
          retry_count: count,
          last_error: lastErrorFinal,
          updated_at: dbNowIso,
          provider_error_code: maxAttemptsHit ? 'MAX_ATTEMPTS' : result.error_code ?? null,
          provider_error_category: maxAttemptsHit ? 'PERMANENT' : result.provider_error_category ?? null,
        }
        : {
          status: 'RETRY' as const,
          retry_count: count,
          next_retry_at: addSecondsIso(dbNowIso, delaySec),
          last_error: lastErrorFinal,
          updated_at: dbNowIso,
          provider_error_code: result.error_code ?? null,
          provider_error_category: result.provider_error_category ?? null,
        };
    },
    prefix,
    'Update COMPLETED/RETRY/FAILED (partial) failed'
  );

  await writeQueueDeadLetterAudit(
    siteId,
    deadLetterRows,
    'MAX_ATTEMPTS',
    'Queue row exhausted retry budget after provider response',
    'MAX_ATTEMPTS'
  );

  for (let i = 0; i < matchedRows.length; i++) {
    const row = matchedRows[i];
    const result = matchedResults[i];
    if (result.status === 'COMPLETED') {
      arena.setStatus(i, 1);
      completed++;
    } else if (result.status === 'RETRY') {
      arena.setStatus(i, 2);
      const count = (row.retry_count ?? 0) + 1;
      const isFatal = count >= MAX_RETRY_ATTEMPTS || result.provider_error_category === 'VALIDATION' || result.provider_error_category === 'AUTH';
      if (isFatal) {
        arena.setStatus(i, 3);
        failed++;
      } else retry++;
    } else {
      arena.setStatus(i, 3);
      failed++;
    }
  }

  return { completed, failed, retry, poisonIds, blockedValueIds: blockedValueZeroIds, uploadResults, providerRequestId, errorCode, errorCategory };
}
