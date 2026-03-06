/**
 * PR-C4: Single OCI runner — claim, gates, adapter, persist.
 * Used by /api/workers/google-ads-oci (mode: worker) and /api/cron/process-offline-conversions (mode: cron).
 * No behavior change; consolidation only.
 *
 * Transaction safety: claim_offline_conversion_jobs_v3 uses
 * FOR UPDATE SKIP LOCKED; no double-claim. Queue transitions are appended per-row and snapped atomically.
 * Failure parity: both modes use MAX_RETRY_ATTEMPTS from constants.ts, increment retry_count,
 * and set provider_error_code / provider_error_category (worker) or last_error (cron).
 */

import { createTenantClient } from '@/lib/supabase/tenant-client';
import { adminClient } from '@/lib/supabase/admin';
import { getProvider } from '@/lib/providers/registry';
import type { UploadResult } from '@/lib/providers/types';
import {
  nextRetryDelaySeconds,
  queueRowToConversionJob,
  type QueueRow,
} from '@/lib/cron/process-offline-conversions';
import { majorToMinor } from '@/lib/i18n/currency';
import {
  acquireSemaphore,
  releaseSemaphore,
  siteProviderKey,
  globalProviderKey,
} from '@/lib/providers/limits/semaphore';
import {
  MAX_RETRY_ATTEMPTS,
  BATCH_SIZE_WORKER,
  DEFAULT_LIMIT_CRON,
  MAX_LIMIT_CRON,
  LIST_GROUPS_LIMIT,
} from '@/lib/oci/constants';
import { insertDeadLetterAuditLogs } from '@/lib/oci/dead-letter-audit';
import {
  buildQueueTransitionErrorPayload,
  type QueueSnapshotUpdatePayload,
} from '@/lib/oci/queue-transition-ledger';
import { chunkArray } from '@/lib/utils/batch';
import { logInfo, logWarn, logError as loggerError } from '@/lib/logging/logger';
import { leadScoreToStar } from '@/lib/domain/mizan-mantik/score';
import { computeConversionValue } from '@/lib/oci/oci-config';

/** Options for runOfflineConversionRunner. */
export interface RunnerOptions {
  /** 'worker' = single-provider (e.g. google_ads), semaphore + ledger. 'cron' = all/filtered providers, health gate + metrics. */
  mode: 'worker' | 'cron';
  /** For mode 'worker': only process this provider (e.g. 'google_ads'). */
  providerKey?: string;
  /** For mode 'cron': optional query filter (provider_key). Null = all providers. */
  providerFilter?: string | null;
  /** For mode 'cron': max jobs per run (default 50, max 500). Ignored for worker (uses BATCH_SIZE_WORKER). */
  limit?: number;
  /** Log prefix for console (e.g. '[google-ads-oci]', '[process-offline-conversions]'). */
  logPrefix?: string;
}

export type RunnerResult =
  | { ok: true; processed: number; completed: number; failed: number; retry: number }
  | { ok: false; error: string };

type GroupRow = {
  site_id: string;
  provider_key: string;
  queued_count: number;
  min_next_retry_at: string | null;
  min_created_at: string;
};

type HealthRow = { state: string; next_probe_at: string | null; probe_limit: number };

async function decryptCredentials(ciphertext: string): Promise<unknown> {
  const vault = await import('@/lib/security/vault').catch(() => null);
  if (!vault?.decryptJson) throw new Error('Vault not configured');
  return vault.decryptJson(ciphertext);
}

function logRunnerError(prefix: string, message: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  loggerError(message, { prefix, error: detail });
}

function getQueueAttemptCount(row: QueueRow, fallback: number): number {
  const raw = (row as QueueRow & { attempt_count?: number | null }).attempt_count;
  const value = raw ?? fallback;
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

async function writeQueueDeadLetterAudit(
  siteId: string,
  rows: QueueRow[],
  errorCode: string,
  errorMessage: string,
  errorCategory: 'PERMANENT' | 'VALIDATION' | 'AUTH' | 'MAX_ATTEMPTS'
): Promise<void> {
  if (rows.length === 0) return;

  await insertDeadLetterAuditLogs(
    rows.map((row) => ({
      siteId,
      resourceType: 'oci_queue',
      resourceId: row.id,
      callId: row.call_id,
      errorCode,
      errorMessage,
      errorCategory,
      attemptCount: getQueueAttemptCount(row, row.retry_count ?? 0),
      pipeline: 'WORKER',
    }))
  );
}

function buildWorkerBatchErrorPayload(payload: QueueSnapshotUpdatePayload): Record<string, unknown> | null {
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

/** Bulk append queue transitions by ids. Reduced O(N) round-trips to O(N/500). */
async function bulkUpdateQueue(
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
async function bulkUpdateQueueGrouped<T>(
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

/** PR-VK-5: Re-read from calls, sanity-check value_cents. Single writer: enqueue is canonical; sync does NOT overwrite. */
async function syncQueueValuesFromCalls(
  siteIdUuid: string,
  siteRows: QueueRow[],
  prefix: string
): Promise<Set<string>> {
  const mismatchIds = new Set<string>();
  const withCallId = siteRows.filter((r) => r.call_id);
  if (withCallId.length === 0) return mismatchIds;

  const callIds = [...new Set(withCallId.map((r) => r.call_id!).filter(Boolean))];
  const { data: callsData } = await adminClient
    .from('calls')
    .select('id, lead_score, sale_amount, currency')
    .in('id', callIds);
  const callsById = new Map(
    (callsData ?? []).map((c: { id: string; lead_score?: number | null; sale_amount?: number | null; currency?: string | null }) => [c.id, c])
  );

  await adminClient
    .from('sites')
    .select('id')
    .eq('id', siteIdUuid)
    .maybeSingle();

  for (const row of withCallId) {
    const call = callsById.get(row.call_id!);
    if (!call) continue;
    const leadScore = call.lead_score ?? null;
    const saleAmount = call.sale_amount != null && Number.isFinite(Number(call.sale_amount)) ? Number(call.sale_amount) : null;
    const star = leadScoreToStar(leadScore);
    const valueUnits = computeConversionValue(star, saleAmount);
    const callCurrency = (call as { currency?: string | null }).currency ?? 'TRY';
    const freshCents = valueUnits != null ? majorToMinor(valueUnits, callCurrency) : row.value_cents;
    const storedCents = typeof row.value_cents === 'number' ? row.value_cents : Number(row.value_cents) ?? 0;
    if (freshCents !== storedCents) {
      logWarn('QUEUE_VALUE_MISMATCH', {
        queue_id: row.id,
        call_id: row.call_id,
        stored_cents: storedCents,
        computed_cents: freshCents,
        prefix,
      });
      mismatchIds.add(row.id);
    }
  }

  return mismatchIds;
}

/** Shared persistence: record_provider_outcome (circuit breaker). Both worker and cron use this. */
async function persistProviderOutcome(
  siteId: string,
  providerKey: string,
  isSuccess: boolean,
  isTransient: boolean,
  prefix: string
): Promise<void> {
  try {
    await adminClient.rpc('record_provider_outcome', {
      p_site_id: siteId,
      p_provider_key: providerKey,
      p_is_success: isSuccess,
      p_is_transient: isTransient,
    });
  } catch (e) {
    logRunnerError(prefix, 'record_provider_outcome failed', e);
  }
}

/** Standardized group outcome log: mode, providerKey, claimed, success, failure, retry. */
function logGroupOutcome(
  prefix: string,
  mode: 'worker' | 'cron',
  providerKey: string,
  claimed_count: number,
  success_count: number,
  failure_count: number,
  retry_count: number
): void {
  logInfo('OCI_GROUP_OUTCOME', { prefix, mode, providerKey, claimed_count, success_count, failure_count, retry_count });
}

/**
 * Single runner: list groups → claim → (per group) credentials → gates → upload → persist.
 */
export async function runOfflineConversionRunner(options: RunnerOptions): Promise<RunnerResult> {
  const {
    mode,
    providerKey: singleProviderKey,
    providerFilter,
    limit: optionLimit,
    logPrefix: prefix = '[oci-runner]',
  } = options;

  // Production safeguard: worker mode requires providerKey (single-provider semantics).
  if (mode === 'worker' && !singleProviderKey) {
    throw new Error('OCI runner: mode worker requires providerKey');
  }

  // Exhaustive mode check: if a new mode is added to RunnerOptions, compilation fails here.
  switch (mode) {
    case 'worker':
    case 'cron':
      break;
    default: {
      const _exhaustive: never = mode;
      return { ok: false, error: `Unknown mode: ${String(_exhaustive)}` };
    }
  }

  const limit =
    mode === 'worker'
      ? BATCH_SIZE_WORKER
      : Math.min(MAX_LIMIT_CRON, Math.max(1, optionLimit ?? DEFAULT_LIMIT_CRON));

  const bySiteAndProvider = new Map<string, QueueRow[]>();
  const writtenMetricsKeys = new Set<string>();

  try {
    const { data: groups, error: listError } = await adminClient.rpc('list_offline_conversion_groups', {
      p_limit_groups: LIST_GROUPS_LIMIT,
    });
    if (listError) {
      return { ok: false, error: listError.message };
    }
    const groupList = (groups ?? []) as GroupRow[];
    const filteredGroups =
      mode === 'worker' && singleProviderKey
        ? groupList.filter((g) => g.provider_key === singleProviderKey)
        : providerFilter
          ? groupList.filter((g) => g.provider_key === providerFilter)
          : groupList;

    if (filteredGroups.length === 0) {
      return { ok: true, processed: 0, completed: 0, failed: 0, retry: 0 };
    }

    const healthByKey: Map<string, HealthRow | null> = new Map();
    const claimLimits = new Map<string, number>();

    if (mode === 'cron') {
      for (const g of filteredGroups) {
        const key = `${g.site_id}:${g.provider_key}`;
        const { data: healthRows } = await adminClient.rpc('get_provider_health_state', {
          p_site_id: g.site_id,
          p_provider_key: g.provider_key,
        });
        healthByKey.set(key, (healthRows as HealthRow[] | null)?.[0] ?? null);
      }
      const closedGroups = filteredGroups.filter((g) => {
        const h = healthByKey.get(`${g.site_id}:${g.provider_key}`);
        return (h?.state ?? 'CLOSED') === 'CLOSED';
      });
      const totalQueued = closedGroups.reduce((s, g) => s + Number(g.queued_count ?? 0), 0);
      if (totalQueued > 0) {
        let sum = 0;
        const raw: { key: string; lim: number; qc: number; min_next_retry_at: string | null; min_created_at: string }[] =
          closedGroups.map((g) => {
            const key = `${g.site_id}:${g.provider_key}`;
            const qc = Number(g.queued_count ?? 0);
            const lim = Math.max(1, Math.floor(limit * (qc / totalQueued)));
            sum += lim;
            return { key, lim, qc, min_next_retry_at: g.min_next_retry_at ?? null, min_created_at: g.min_created_at ?? '' };
          });
        while (sum > limit && raw.length > 0) {
          raw.sort((a, b) => {
            if (b.lim !== a.lim) return b.lim - a.lim;
            const an = a.min_next_retry_at ?? '';
            const bn = b.min_next_retry_at ?? '';
            if (an !== bn) return an.localeCompare(bn);
            return (a.min_created_at ?? '').localeCompare(b.min_created_at ?? '');
          });
          const r = raw[0];
          if (r.lim <= 1) break;
          r.lim--;
          sum--;
        }
        let leftover = limit - sum;
        let ri = 0;
        while (leftover > 0 && raw.length > 0) {
          const r = raw[ri % raw.length];
          if (r.lim < r.qc) {
            r.lim++;
            leftover--;
          }
          ri++;
          if (ri > raw.length * 2) break;
        }
        raw.forEach((r) => claimLimits.set(r.key, r.lim));
      }
    }

    let remaining = limit;
    const maxGroups = Math.min(filteredGroups.length, 100);
    for (let i = 0; i < maxGroups && remaining > 0; i++) {
      const g = filteredGroups[i];
      const siteId = g.site_id;
      const provKey = g.provider_key;
      const key = `${siteId}:${provKey}`;

      if (mode === 'cron') {
        const health = healthByKey.get(key) ?? null;
        const state = health?.state ?? 'CLOSED';
        if (state === 'OPEN') continue;
        const probeLimit = health?.probe_limit ?? 5;
        const claimLimit =
          state === 'HALF_OPEN'
            ? Math.min(probeLimit, remaining)
            : Math.min(claimLimits.get(key) ?? Math.max(1, Math.floor(remaining / (maxGroups - i))), remaining);
        const { data: rows, error: claimError } = await adminClient.rpc('claim_offline_conversion_jobs_v3', {
          p_site_id: siteId,
          p_provider_key: provKey,
          p_limit: claimLimit,
        });
        if (claimError) continue;
        const claimedRows = (rows ?? []) as QueueRow[];
        if (claimedRows.length === 0) continue;
        remaining -= claimedRows.length;
        bySiteAndProvider.set(key, claimedRows);
      } else {
        const claimLimit = Math.min(remaining, Math.max(1, Number(g.queued_count ?? 0)));
        const { data: rows, error: claimError } = await adminClient.rpc('claim_offline_conversion_jobs_v3', {
          p_site_id: siteId,
          p_provider_key: provKey,
          p_limit: claimLimit,
        });
        if (claimError) {
          logRunnerError(prefix, `claim failed for ${siteId}`, claimError);
          continue;
        }
        const claimedRows = (rows ?? []) as QueueRow[];
        if (claimedRows.length > 0) {
          bySiteAndProvider.set(key, claimedRows);
          remaining -= claimedRows.length;
        }
      }
    }

    const allClaimed = Array.from(bySiteAndProvider.values()).flat();
    if (allClaimed.length === 0) {
      return { ok: true, processed: 0, completed: 0, failed: 0, retry: 0 };
    }

    let completed = 0;
    let failed = 0;
    let retry = 0;

    async function writeProviderMetrics(
      siteId: string,
      provKey: string,
      attempts: number,
      completedDelta: number,
      failedDelta: number,
      retryDelta: number
    ): Promise<void> {
      try {
        await adminClient.rpc('increment_provider_upload_metrics', {
          p_site_id: siteId,
          p_provider_key: provKey,
          p_attempts_delta: attempts,
          p_completed_delta: completedDelta,
          p_failed_delta: failedDelta,
          p_retry_delta: retryDelta,
        });
        writtenMetricsKeys.add(`${siteId}:${provKey}`);
      } catch (e) {
        logWarn('OCI_increment_provider_upload_metrics_failed', { prefix, error: e instanceof Error ? e.message : String(e) });
      }
    }

    for (const [, siteRows] of bySiteAndProvider) {
      const first = siteRows[0];
      const siteIdUuid = first.site_id;
      const providerKey = first.provider_key;
      let groupCompleted = 0;
      let groupFailed = 0;
      let groupRetry = 0;

      const tenantClient = createTenantClient(siteIdUuid);
      let encryptedPayload: string | null = null;

      try {
        const { data: credsData, error: credsErr } = await tenantClient
          .from('provider_credentials')
          .select('encrypted_payload')
          .eq('provider_key', providerKey)
          .eq('is_active', true)
          .maybeSingle();

        if (credsErr) throw credsErr;
        encryptedPayload = (credsData as { encrypted_payload?: string } | null)?.encrypted_payload ?? null;
      } catch (err) {
        logRunnerError(prefix, 'provider_credentials fetch failed', err);
        encryptedPayload = null;
      }

      if (!encryptedPayload) {
        const lastError = 'Credentials missing or decryption failed';
        await bulkUpdateQueue(
          siteRows.map((r) => r.id),
          { status: 'FAILED', last_error: lastError, updated_at: new Date().toISOString() },
          prefix,
          'Update FAILED (credentials) failed'
        );
        failed += siteRows.length;
        if (mode === 'cron') await writeProviderMetrics(siteIdUuid, providerKey, siteRows.length, 0, siteRows.length, 0);
        continue;
      }

      let credentials: unknown;
      try {
        credentials = await decryptCredentials(encryptedPayload);
      } catch (err) {
        logRunnerError(prefix, 'Decrypt credentials failed', err);
        const lastError = 'Credentials missing or decryption failed';
        await bulkUpdateQueue(
          siteRows.map((r) => r.id),
          { status: 'FAILED', last_error: lastError, updated_at: new Date().toISOString() },
          prefix,
          'Update FAILED (decrypt) failed'
        );
        failed += siteRows.length;
        if (mode === 'cron') await writeProviderMetrics(siteIdUuid, providerKey, siteRows.length, 0, siteRows.length, 0);
        continue;
      }

      if (mode === 'worker') {
        const limitSite = Math.max(1, parseInt(process.env.CONCURRENCY_PER_SITE_PROVIDER ?? '2', 10) || 2);
        const globalLimit = Math.max(0, parseInt(process.env.CONCURRENCY_GLOBAL_PER_PROVIDER ?? '10', 10));
        const ttlMs = Math.max(60000, parseInt(process.env.SEMAPHORE_TTL_MS ?? '120000', 10) || 120000);
        const siteKey = siteProviderKey(siteIdUuid, providerKey);
        const globalKey = globalProviderKey(providerKey);
        let siteToken: string | null = await acquireSemaphore(siteKey, limitSite, ttlMs);
        if (!siteToken) {
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
          });
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
          });
          await persistProviderOutcome(siteIdUuid, providerKey, false, true, prefix);
          logGroupOutcome(prefix, 'worker', providerKey, siteRows.length, 0, 0, siteRows.length);
          retry += siteRows.length;
          continue;
        }
        let globalToken: string | null = null;
        if (globalLimit > 0) {
          globalToken = await acquireSemaphore(globalKey, globalLimit, ttlMs);
          if (!globalToken) {
            await releaseSemaphore(siteKey, siteToken);
            siteToken = null;
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
            });
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
            });
            await persistProviderOutcome(siteIdUuid, providerKey, false, true, prefix);
            logGroupOutcome(prefix, 'worker', providerKey, siteRows.length, 0, 0, siteRows.length);
            retry += siteRows.length;
            continue;
          }
        }

        const mismatchIds = await syncQueueValuesFromCalls(siteIdUuid, siteRows, prefix);
        const failClosed = process.env.QUEUE_VALUE_MISMATCH_FAIL_CLOSED === '1';

        if (failClosed && mismatchIds.size > 0) {
          await bulkUpdateQueue(
            [...mismatchIds],
            { status: 'QUEUED', next_retry_at: null, updated_at: new Date().toISOString() },
            prefix,
            'Release mismatch rows (fail-closed) to QUEUED'
          );
          logInfo('QUEUE_VALUE_MISMATCH_FAIL_CLOSED', {
            site_id: siteIdUuid,
            skipped_count: mismatchIds.size,
            prefix,
          });
        }

        const adapter = getProvider(providerKey);
        const blockedValueZeroIds: string[] = [];
        const rowsWithValue = siteRows.filter((r) => {
          if (failClosed && mismatchIds.has(r.id)) return false;
          const raw = (r as { value_cents?: unknown }).value_cents;
          const v = typeof raw === 'number' ? raw : Number(raw);
          if (raw == null || raw === undefined) {
            logWarn('OCI_ROW_SKIP_NULL_VALUE', { queue_id: r.id, prefix });
            blockedValueZeroIds.push(r.id);
            return false;
          }
          if (!Number.isFinite(v) || v <= 0) {
            logWarn('OCI_ROW_SKIP_VALUE_ZERO', { queue_id: r.id, prefix, raw_value_cents: raw ?? null });
            blockedValueZeroIds.push(r.id);
            return false;
          }
          (r as { value_cents: number }).value_cents = v;
          return true;
        });
        if (blockedValueZeroIds.length > 0) {
          await bulkUpdateQueue(
            blockedValueZeroIds,
            {
              status: 'FAILED',
              last_error: 'VALUE_ZERO',
              provider_error_code: 'VALUE_ZERO',
              provider_error_category: 'PERMANENT',
              updated_at: new Date().toISOString(),
            },
            prefix,
            'Mark value_cents<=0 rows FAILED'
          );
        }
        // Axiom 4: Per-row isolation — one poison pill does not kill the batch
        const jobs: Awaited<ReturnType<typeof queueRowToConversionJob>>[] = [];
        const poisonRowIds: string[] = [];
        for (const r of rowsWithValue) {
          try {
            jobs.push(queueRowToConversionJob(r));
          } catch (err) {
            // const msg = err instanceof Error ? err.message : String(err); // unused
            logRunnerError(prefix, 'queueRowToConversionJob poison pill (row isolated)', err);
            poisonRowIds.push(r.id);
          }
        }
        if (poisonRowIds.length > 0) {
          await bulkUpdateQueue(
            poisonRowIds,
            {
              status: 'DEAD_LETTER_QUARANTINE',
              last_error: 'POISON_PILL: Malformed payload or conversion_time',
              provider_error_code: 'POISON_PILL',
              provider_error_category: 'PERMANENT',
              updated_at: new Date().toISOString(),
            },
            prefix,
            'Mark poison pill rows DEAD_LETTER'
          );
          await writeQueueDeadLetterAudit(
            siteIdUuid,
            rowsWithValue.filter((row) => poisonRowIds.includes(row.id)),
            'POISON_PILL',
            'POISON_PILL: Malformed payload or conversion_time',
            'PERMANENT'
          );
        }
        // Enhanced Conversions: enrich job.payload with caller_phone_hash_sha256 from calls (hashed_phone_number)
        const callIds = [...new Set(rowsWithValue.map((r) => (r as { call_id?: string | null }).call_id).filter(Boolean))] as string[];
        if (callIds.length > 0 && jobs.length > 0) {
          try {
            const rowIdToRow = new Map(rowsWithValue.map((r) => [r.id, r]));
            const { data: callsData } = await adminClient
              .from('calls')
              .select('id, caller_phone_hash_sha256')
              .in('id', callIds);
            const hashByCallId = new Map<string, string>();
            for (const c of callsData ?? []) {
              const hash = (c as { caller_phone_hash_sha256?: string | null }).caller_phone_hash_sha256;
              if (hash && typeof hash === 'string' && hash.trim().length === 64) {
                hashByCallId.set((c as { id: string }).id, hash.trim());
              }
            }
            for (let i = 0; i < jobs.length; i++) {
              const row = rowIdToRow.get(jobs[i].id);
              if (!row) continue;
              const callId = (row as { call_id?: string | null }).call_id;
              const hashedPhone = callId ? hashByCallId.get(callId) : null;
              if (hashedPhone) {
                jobs[i].payload = { ...(jobs[i].payload ?? {}), hashed_phone_number: hashedPhone };
              }
            }
          } catch {
            // Non-critical; upload continues without user_identifiers
          }
        }
        if (jobs.length === 0) {
          // Nothing left to upload after policy blocks/poison isolation.
          continue;
        }
        const batchId = crypto.randomUUID();
        const startedAt = Date.now();
        let attemptCompleted = 0;
        let attemptFailed = 0;
        let attemptRetry = 0;
        let attemptRequestId: string | null = null;
        let attemptErrorCode: string | null = null;
        let attemptErrorCategory: string | null = null;
        let results: UploadResult[] | undefined;

        try {
          const { error: startedErr } = await adminClient.from('provider_upload_attempts').insert({
            site_id: siteIdUuid,
            provider_key: providerKey,
            batch_id: batchId,
            phase: 'STARTED',
            claimed_count: siteRows.length,
          });
          if (startedErr) logRunnerError(prefix, 'Ledger STARTED insert failed', startedErr);

          try {
            results = await adapter.uploadConversions({ jobs, credentials });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logRunnerError(prefix, 'Adapter uploadConversions threw', err);
            attemptErrorCode = null;
            attemptErrorCategory = 'TRANSIENT';
            const rowsToRetry = rowsWithValue.filter((r) => !poisonRowIds.includes(r.id));
            const rowsToDeadLetter = rowsToRetry.filter((row) => (row.retry_count ?? 0) + 1 >= MAX_RETRY_ATTEMPTS);
            await bulkUpdateQueueGrouped(
              rowsToRetry,
              (r) => r.id,
              (row) => {
                const count = (row.retry_count ?? 0) + 1;
                const isFinal = count >= MAX_RETRY_ATTEMPTS;
                const delaySec = nextRetryDelaySeconds(row.retry_count ?? 0);
                const lastErrorFinal = `Max retries reached: ${msg}`.slice(0, 1000);
                return isFinal
                  ? {
                    status: 'DEAD_LETTER_QUARANTINE' as const,
                    retry_count: count,
                    last_error: lastErrorFinal,
                    updated_at: new Date().toISOString(),
                    provider_error_code: 'MAX_ATTEMPTS',
                    provider_error_category: 'PERMANENT' as const,
                  }
                  : {
                    status: 'RETRY' as const,
                    retry_count: count,
                    next_retry_at: new Date(Date.now() + delaySec * 1000).toISOString(),
                    last_error: msg.slice(0, 1000),
                    updated_at: new Date().toISOString(),
                    provider_error_code: null,
                    provider_error_category: 'TRANSIENT' as const,
                  };
              },
              prefix,
              'Update RETRY/DEAD_LETTER after throw failed'
            );
            await writeQueueDeadLetterAudit(siteIdUuid, rowsToDeadLetter, 'MAX_ATTEMPTS', msg, 'MAX_ATTEMPTS');
            for (const row of rowsToRetry) {
              const count = (row.retry_count ?? 0) + 1;
              const isFinal = count >= MAX_RETRY_ATTEMPTS;
              if (isFinal) {
                attemptFailed++;
                failed++;
              } else {
                attemptRetry++;
                retry++;
              }
            }
            attemptFailed += poisonRowIds.length;
            failed += poisonRowIds.length;
          }

          if (results !== undefined) {
            const rowById = new Map(rowsWithValue.map((r) => [r.id, r]));
            const updates: { row: QueueRow; result: UploadResult }[] = [];
            for (const result of results) {
              const row = rowById.get(result.job_id);
              if (!row) continue;
              updates.push({ row, result });
            }
            const deadLetterUpdates = updates.filter(({ row, result }) => {
              if (result.status !== 'RETRY') return false;
              const count = (row.retry_count ?? 0) + 1;
              return count >= MAX_RETRY_ATTEMPTS;
            });
            await bulkUpdateQueueGrouped(
              updates,
              (u) => u.row.id,
              ({ row, result }): QueueSnapshotUpdatePayload => {
                if (result.status === 'COMPLETED') {
                  if (result.provider_request_id && attemptRequestId == null) attemptRequestId = result.provider_request_id;
                  const payload: QueueSnapshotUpdatePayload = {
                    status: 'COMPLETED',
                    last_error: null,
                    updated_at: new Date().toISOString(),
                    uploaded_at: new Date().toISOString(),
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
                const lastErrorFinal = isFatal
                  ? `FINAL: ${errorMsg}`.slice(0, 1000)
                  : errorMsg.slice(0, 1000);
                return isFatal
                  ? {
                    status: maxAttemptsHit ? 'DEAD_LETTER_QUARANTINE' as const : 'FAILED' as const,
                    retry_count: count,
                    last_error: lastErrorFinal,
                    updated_at: new Date().toISOString(),
                    provider_error_code: maxAttemptsHit ? 'MAX_ATTEMPTS' : result.error_code ?? null,
                    provider_error_category: maxAttemptsHit ? 'PERMANENT' : result.provider_error_category ?? null,
                  }
                  : {
                    status: 'RETRY' as const,
                    retry_count: count,
                    next_retry_at: new Date(Date.now() + delaySec * 1000).toISOString(),
                    last_error: lastErrorFinal,
                    updated_at: new Date().toISOString(),
                    provider_error_code: result.error_code ?? null,
                    provider_error_category: result.provider_error_category ?? null,
                  };
                const lastError = (result.error_message ?? 'Unknown error').slice(0, 1000);
                return {
                  status: 'FAILED',
                  last_error: lastError,
                  updated_at: new Date().toISOString(),
                  provider_error_code: result.error_code ?? null,
                  provider_error_category: result.provider_error_category ?? null,
                };
              },
              prefix,
              'Update COMPLETED/RETRY/FAILED (partial) failed'
            );
            await writeQueueDeadLetterAudit(
              siteIdUuid,
              deadLetterUpdates.map(({ row }) => row),
              'MAX_ATTEMPTS',
              'Queue row exhausted retry budget after provider response',
              'MAX_ATTEMPTS'
            );
            for (const { row, result } of updates) {
              if (result.status === 'COMPLETED') {
                attemptCompleted++;
                completed++;
              } else if (result.status === 'RETRY') {
                const count = (row.retry_count ?? 0) + 1;
                const isFatal = count >= MAX_RETRY_ATTEMPTS || result.provider_error_category === 'VALIDATION' || result.provider_error_category === 'AUTH';
                if (isFatal) {
                  attemptFailed++;
                  failed++;
                } else {
                  attemptRetry++;
                  retry++;
                }
              } else {
                attemptFailed++;
                failed++;
              }
            }
          }

          const durationMs = Date.now() - startedAt;
          const { error: finishedErr } = await adminClient.from('provider_upload_attempts').insert({
            site_id: siteIdUuid,
            provider_key: providerKey,
            batch_id: batchId,
            phase: 'FINISHED',
            claimed_count: siteRows.length,
            completed_count: attemptCompleted,
            failed_count: attemptFailed,
            retry_count: attemptRetry,
            duration_ms: durationMs,
            provider_request_id: attemptRequestId,
            error_code: attemptErrorCode,
            error_category: attemptErrorCategory,
          });
          if (finishedErr) logRunnerError(prefix, 'Ledger FINISHED insert failed', finishedErr);

          const isTransient = attemptRetry > 0 || attemptErrorCategory === 'TRANSIENT';
          await persistProviderOutcome(siteIdUuid, providerKey, attemptCompleted > 0, isTransient, prefix);
          logGroupOutcome(prefix, 'worker', providerKey, siteRows.length, attemptCompleted, attemptFailed, attemptRetry);
        } finally {
          if (siteToken) await releaseSemaphore(siteKey, siteToken);
          if (globalToken) await releaseSemaphore(globalKey, globalToken);
        }
        continue;
      }

      if (mode === 'cron') {
        const { data: healthRows } = await adminClient.rpc('get_provider_health_state', {
          p_site_id: siteIdUuid,
          p_provider_key: providerKey,
        });
        const health: HealthRow | null = (healthRows as HealthRow[] | null)?.[0] ?? null;
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
              const isFatal = count >= MAX_RETRY_ATTEMPTS;
              if (isFatal) failed++;
              else retry++;
            }
            continue;
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

        const mismatchIdsCron = await syncQueueValuesFromCalls(siteIdUuid, rowsToProcess, prefix);
        const failClosedCron = process.env.QUEUE_VALUE_MISMATCH_FAIL_CLOSED === '1';

        if (failClosedCron && mismatchIdsCron.size > 0) {
          await bulkUpdateQueue(
            [...mismatchIdsCron],
            { status: 'QUEUED', next_retry_at: null, updated_at: new Date().toISOString() },
            prefix,
            'Release mismatch rows (fail-closed cron) to QUEUED'
          );
          logInfo('QUEUE_VALUE_MISMATCH_FAIL_CLOSED', {
            site_id: siteIdUuid,
            skipped_count: mismatchIdsCron.size,
            prefix,
          });
        }

        const blockedValueZeroIdsCron: string[] = [];
        const rowsWithValue = rowsToProcess.filter((r) => {
          if (failClosedCron && mismatchIdsCron.has(r.id)) return false;
          const raw = (r as { value_cents?: unknown }).value_cents;
          const v = typeof raw === 'number' ? raw : Number(raw);
          if (raw == null || raw === undefined) {
            logWarn('OCI_ROW_SKIP_NULL_VALUE', { queue_id: r.id, prefix });
            blockedValueZeroIdsCron.push(r.id);
            return false;
          }
          if (!Number.isFinite(v) || v <= 0) {
            logWarn('OCI_ROW_SKIP_VALUE_ZERO', { queue_id: r.id, prefix, raw_value_cents: raw ?? null });
            blockedValueZeroIdsCron.push(r.id);
            return false;
          }
          (r as { value_cents: number }).value_cents = v;
          return true;
        });
        if (blockedValueZeroIdsCron.length > 0) {
          await bulkUpdateQueue(
            blockedValueZeroIdsCron,
            {
              status: 'FAILED',
              last_error: 'VALUE_ZERO',
              provider_error_code: 'VALUE_ZERO',
              provider_error_category: 'PERMANENT',
              updated_at: new Date().toISOString(),
            },
            prefix,
            'Mark value_cents<=0 rows FAILED (cron)'
          );
        }
        const adapter = getProvider(providerKey);
        // Axiom 4: Per-row isolation — one poison pill does not kill the batch
        const jobs: Awaited<ReturnType<typeof queueRowToConversionJob>>[] = [];
        const poisonRowIdsCron: string[] = [];
        for (const r of rowsWithValue) {
          try {
            jobs.push(queueRowToConversionJob(r));
          } catch (err) {
            logRunnerError(prefix, 'queueRowToConversionJob poison pill (cron row isolated)', err);
            poisonRowIdsCron.push(r.id);
          }
        }
        if (poisonRowIdsCron.length > 0) {
          await bulkUpdateQueue(
            poisonRowIdsCron,
            {
              status: 'DEAD_LETTER_QUARANTINE',
              last_error: 'POISON_PILL: Malformed payload or conversion_time',
              provider_error_code: 'POISON_PILL',
              provider_error_category: 'PERMANENT',
              updated_at: new Date().toISOString(),
            },
            prefix,
            'Mark poison pill rows DEAD_LETTER (cron)'
          );
          await writeQueueDeadLetterAudit(
            siteIdUuid,
            rowsWithValue.filter((row) => poisonRowIdsCron.includes(row.id)),
            'POISON_PILL',
            'POISON_PILL: Malformed payload or conversion_time',
            'PERMANENT'
          );
        }
        // Enhanced Conversions: enrich job.payload with caller_phone_hash_sha256 from calls
        const callIdsCron = [...new Set(rowsWithValue.map((r) => (r as { call_id?: string | null }).call_id).filter(Boolean))] as string[];
        if (callIdsCron.length > 0 && jobs.length > 0) {
          try {
            const rowIdToRowCron = new Map(rowsWithValue.map((r) => [r.id, r]));
            const { data: callsDataCron } = await adminClient
              .from('calls')
              .select('id, caller_phone_hash_sha256')
              .in('id', callIdsCron);
            const hashByCallIdCron = new Map<string, string>();
            for (const c of callsDataCron ?? []) {
              const hash = (c as { caller_phone_hash_sha256?: string | null }).caller_phone_hash_sha256;
              if (hash && typeof hash === 'string' && hash.trim().length === 64) {
                hashByCallIdCron.set((c as { id: string }).id, hash.trim());
              }
            }
            for (let i = 0; i < jobs.length; i++) {
              const row = rowIdToRowCron.get(jobs[i].id);
              if (!row) continue;
              const callId = (row as { call_id?: string | null }).call_id;
              const hashedPhone = callId ? hashByCallIdCron.get(callId) : null;
              if (hashedPhone) {
                jobs[i].payload = { ...(jobs[i].payload ?? {}), hashed_phone_number: hashedPhone };
              }
            }
          } catch {
            // Non-critical
          }
        }
        if (jobs.length === 0) {
          // Nothing left to upload after policy blocks/poison isolation.
          continue;
        }
        let results: UploadResult[];
        try {
          results = await adapter.uploadConversions({ jobs, credentials });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const rowsToRetryCron = rowsWithValue.filter((r) => !poisonRowIdsCron.includes(r.id));
          const rowsToDeadLetterCron = rowsToRetryCron.filter((row) => (row.retry_count ?? 0) + 1 >= MAX_RETRY_ATTEMPTS);
          await bulkUpdateQueueGrouped(
            rowsToRetryCron,
            (r) => r.id,
            (row) => {
              const count = (row.retry_count ?? 0) + 1;
              const isFinal = count >= MAX_RETRY_ATTEMPTS;
              const delay = nextRetryDelaySeconds(row.retry_count ?? 0);
              return isFinal
                ? {
                  status: 'DEAD_LETTER_QUARANTINE' as const,
                  retry_count: count,
                  last_error: msg.slice(0, 1000),
                  updated_at: new Date().toISOString(),
                  provider_error_code: 'MAX_ATTEMPTS',
                  provider_error_category: 'PERMANENT' as const,
                }
                : {
                  status: 'RETRY' as const,
                  retry_count: count,
                  next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
                  last_error: msg.slice(0, 1000),
                  updated_at: new Date().toISOString(),
                };
            },
            prefix,
            'Update RETRY/DEAD_LETTER (cron adapter throw) failed'
          );
          await writeQueueDeadLetterAudit(siteIdUuid, rowsToDeadLetterCron, 'MAX_ATTEMPTS', msg, 'MAX_ATTEMPTS');
          for (const row of rowsToRetryCron) {
            const count = (row.retry_count ?? 0) + 1;
            const isFatal = count >= MAX_RETRY_ATTEMPTS;
            if (isFatal) {
              failed++;
              groupFailed++;
            } else {
              retry++;
              groupRetry++;
            }
          }
          failed += poisonRowIdsCron.length;
          groupFailed += poisonRowIdsCron.length;
          await writeProviderMetrics(siteIdUuid, providerKey, rowsToProcess.length, 0, groupFailed, groupRetry);
          await persistProviderOutcome(siteIdUuid, providerKey, false, true, prefix);
          logGroupOutcome(prefix, 'cron', providerKey, rowsToProcess.length, 0, groupFailed, groupRetry);
          continue;
        }

        const rowById = new Map(rowsWithValue.map((r) => [r.id, r]));
        const cronUpdates: { row: QueueRow; result: UploadResult }[] = [];
        for (const result of results) {
          const row = rowById.get(result.job_id);
          if (!row) continue;
          cronUpdates.push({ row, result });
        }
        const cronDeadLetterUpdates = cronUpdates.filter(({ row, result }) => {
          if (result.status !== 'RETRY') return false;
          return (row.retry_count ?? 0) + 1 >= MAX_RETRY_ATTEMPTS;
        });
        await bulkUpdateQueueGrouped(
          cronUpdates,
          (u) => u.row.id,
          ({ row, result }) => {
            if (result.status === 'COMPLETED') {
              return {
                status: 'COMPLETED',
                last_error: null,
                updated_at: new Date().toISOString(),
                ...(result.provider_ref != null && { provider_ref: result.provider_ref }),
              };
            }
            if (result.status === 'RETRY') {
              const count = (row.retry_count ?? 0) + 1;
              const maxAttemptsHit = count >= MAX_RETRY_ATTEMPTS;
              const isFatal = maxAttemptsHit || result.provider_error_category === 'VALIDATION' || result.provider_error_category === 'AUTH';
              const delay = nextRetryDelaySeconds(count);
              const lastErr = (result.error_message ?? '').slice(0, 1000);
              return isFatal
                ? {
                  status: maxAttemptsHit ? 'DEAD_LETTER_QUARANTINE' as const : 'FAILED' as const,
                  retry_count: count,
                  last_error: lastErr,
                  updated_at: new Date().toISOString(),
                  provider_error_code: maxAttemptsHit ? 'MAX_ATTEMPTS' : result.error_code ?? null,
                  provider_error_category: maxAttemptsHit ? 'PERMANENT' : result.provider_error_category ?? null,
                }
                : {
                  status: 'RETRY' as const,
                  retry_count: count,
                  next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
                  last_error: lastErr,
                  updated_at: new Date().toISOString(),
                };
            }
            return {
              status: 'FAILED',
              last_error: (result.error_message ?? '').slice(0, 1000),
              updated_at: new Date().toISOString(),
            };
          },
          prefix,
          'Update COMPLETED/RETRY/FAILED (cron results) failed'
        );
        await writeQueueDeadLetterAudit(
          siteIdUuid,
          cronDeadLetterUpdates.map(({ row }) => row),
          'MAX_ATTEMPTS',
          'Queue row exhausted retry budget in cron runner',
          'MAX_ATTEMPTS'
        );
        for (const { row, result } of cronUpdates) {
          if (result.status === 'COMPLETED') {
            completed++;
            groupCompleted++;
          } else if (result.status === 'RETRY') {
            const count = (row.retry_count ?? 0) + 1;
            const isFatal = count >= MAX_RETRY_ATTEMPTS || result.provider_error_category === 'VALIDATION' || result.provider_error_category === 'AUTH';
            if (isFatal) {
              failed++;
              groupFailed++;
            } else {
              retry++;
              groupRetry++;
            }
          } else {
            failed++;
            groupFailed++;
          }
        }
        await writeProviderMetrics(siteIdUuid, providerKey, rowsToProcess.length, groupCompleted, groupFailed, groupRetry);
        await persistProviderOutcome(siteIdUuid, providerKey, groupCompleted > 0, groupRetry > 0, prefix);
        logGroupOutcome(prefix, 'cron', providerKey, rowsToProcess.length, groupCompleted, groupFailed, groupRetry);
      }
    }

    logInfo('OCI_RUN_COMPLETE', { prefix, mode, processed: allClaimed.length, completed, failed, retry });
    return { ok: true, processed: allClaimed.length, completed, failed, retry };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (mode === 'cron') {
      for (const [key, siteRows] of bySiteAndProvider) {
        if (writtenMetricsKeys.has(key)) continue;
        const first = siteRows[0];
        try {
          await adminClient.rpc('increment_provider_upload_metrics', {
            p_site_id: first.site_id,
            p_provider_key: first.provider_key,
            p_attempts_delta: siteRows.length,
            p_completed_delta: 0,
            p_failed_delta: 0,
            p_retry_delta: 0,
          });
        } catch (e) {
          logWarn('OCI_crash_path_increment_metrics_failed', { prefix, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    return { ok: false, error: msg };
  }
}
