/**
 * PR-C4: Single OCI runner — claim, gates, adapter, persist.
 * Used by /api/workers/google-ads-oci (mode: worker) and /api/cron/process-offline-conversions (mode: cron).
 * No behavior change; consolidation only.
 *
 * Transaction safety: claim_offline_conversion_jobs_v2 (migration 20260220110000) uses
 * FOR UPDATE SKIP LOCKED; no double-claim. Queue updates are per-row (atomic).
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
import { chunkArray } from '@/lib/utils/batch';
import { logInfo, logWarn, logError as loggerError } from '@/lib/logging/logger';
import { parseOciConfig, computeConversionValue } from '@/lib/oci/oci-config';

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

/** Bulk update queue rows by ids. Reduced O(N) round-trips to O(N/500). */
async function bulkUpdateQueue(
  ids: string[],
  payload: Record<string, unknown>,
  prefix: string,
  logLabel: string
): Promise<void> {
  const chunks = chunkArray(ids, 500);
  const start = Date.now();
  for (const chunk of chunks) {
    const { error } = await adminClient
      .from('offline_conversion_queue')
      .update(payload)
      .in('id', chunk);
    if (error) logRunnerError(prefix, logLabel, error);
  }
  const durationMs = Date.now() - start;
  if (ids.length > 0) {
    logInfo('OCI_BULK_UPDATE', { idsCount: ids.length, chunks: chunks.length, durationMs, prefix });
  }
}

/** Group rows by identical payload; bulk update each group. */
async function bulkUpdateQueueGrouped<T>(
  rows: T[],
  idFn: (r: T) => string,
  payloadFn: (r: T) => Record<string, unknown>,
  prefix: string,
  logLabel: string
): Promise<void> {
  const byKey = new Map<string, { payload: Record<string, unknown>; ids: string[] }>();
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

/** Sprint 2: Re-read lead_score/sale_amount from calls and sync queue value_cents before send. Only for rows with call_id. */
async function syncQueueValuesFromCalls(
  siteIdUuid: string,
  siteRows: QueueRow[],
  prefix: string
): Promise<void> {
  const withCallId = siteRows.filter((r) => r.call_id);
  if (withCallId.length === 0) return;

  const callIds = [...new Set(withCallId.map((r) => r.call_id!).filter(Boolean))];
  const { data: callsData } = await adminClient
    .from('calls')
    .select('id, lead_score, sale_amount, currency')
    .in('id', callIds);
  const callsById = new Map(
    (callsData ?? []).map((c: { id: string; lead_score?: number | null; sale_amount?: number | null; currency?: string | null }) => [c.id, c])
  );

  const { data: siteRow } = await adminClient.from('sites').select('oci_config').eq('id', siteIdUuid).maybeSingle();
  const config = parseOciConfig((siteRow as { oci_config?: unknown } | null)?.oci_config ?? null);

  function leadScoreToStar(leadScore: number | null): number | null {
    if (leadScore == null || !Number.isFinite(leadScore)) return null;
    return Math.round(Math.max(0, Math.min(100, leadScore)) / 20);
  }

  const toUpdate: { id: string; value_cents: number }[] = [];
  for (const row of withCallId) {
    const call = callsById.get(row.call_id!);
    if (!call) continue;
    const leadScore = call.lead_score ?? null;
    const saleAmount = call.sale_amount != null && Number.isFinite(Number(call.sale_amount)) ? Number(call.sale_amount) : null;
    const star = leadScoreToStar(leadScore);
    const valueUnits = computeConversionValue(star, saleAmount, config);
    const callCurrency = (call as { currency?: string | null }).currency ?? 'TRY';
    const freshCents = valueUnits != null ? majorToMinor(valueUnits, callCurrency) : row.value_cents;
    if (freshCents !== row.value_cents) {
      (row as { value_cents: number }).value_cents = freshCents;
      toUpdate.push({ id: row.id, value_cents: freshCents });
    }
  }

  if (toUpdate.length > 0) {
    for (const { id, value_cents } of toUpdate) {
      const { error } = await adminClient.from('offline_conversion_queue').update({ value_cents, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) logRunnerError(prefix, 'Sync queue value_cents from call failed', error);
    }
    logInfo('OCI_VALUE_SYNC', { site_id: siteIdUuid, updated_count: toUpdate.length, prefix });
  }
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
        const { data: rows, error: claimError } = await adminClient.rpc('claim_offline_conversion_jobs_v2', {
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
        const { data: rows, error: claimError } = await adminClient.rpc('claim_offline_conversion_jobs_v2', {
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

        await syncQueueValuesFromCalls(siteIdUuid, siteRows, prefix);

        const adapter = getProvider(providerKey);
        const rowsWithValue = siteRows.filter((r) => {
          const v = (r as { value_cents?: number | null }).value_cents;
          if (v == null || v === undefined) {
            logWarn('OCI_ROW_SKIP_NULL_VALUE', { queue_id: r.id, prefix });
            return false;
          }
          return true;
        });
        const jobs = rowsWithValue.map((r) => queueRowToConversionJob(r));
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
            await bulkUpdateQueueGrouped(
              rowsWithValue,
              (r) => r.id,
              (row) => {
                const count = (row.retry_count ?? 0) + 1;
                const isFinal = count >= MAX_RETRY_ATTEMPTS;
                const delaySec = nextRetryDelaySeconds(row.retry_count ?? 0);
                const lastErrorFinal = `Max retries reached: ${msg}`.slice(0, 1000);
                return isFinal
                  ? {
                    status: 'FAILED' as const,
                    retry_count: count,
                    last_error: lastErrorFinal,
                    updated_at: new Date().toISOString(),
                    provider_error_code: null,
                    provider_error_category: 'TRANSIENT' as const,
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
              'Update RETRY/FAILED after throw failed'
            );
            for (const row of rowsWithValue) {
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
          }

          if (results !== undefined) {
            const rowById = new Map(rowsWithValue.map((r) => [r.id, r]));
            const updates: { row: QueueRow; result: UploadResult }[] = [];
            for (const result of results) {
              const row = rowById.get(result.job_id);
              if (!row) continue;
              updates.push({ row, result });
            }
            await bulkUpdateQueueGrouped(
              updates,
              (u) => u.row.id,
              ({ row, result }) => {
                if (result.status === 'COMPLETED') {
                  if (result.provider_request_id && attemptRequestId == null) attemptRequestId = result.provider_request_id;
                  const payload: Record<string, unknown> = {
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
                const isFatal = count >= 8 || result.provider_error_category === 'VALIDATION' || result.provider_error_category === 'AUTH';
                const delaySec = nextRetryDelaySeconds(count);
                const errorMsg = result.error_message ?? 'Unknown error';
                const lastErrorFinal = isFatal
                  ? `FATAL: ${errorMsg}`.slice(0, 1000)
                  : errorMsg.slice(0, 1000);
                return isFatal
                  ? {
                    status: 'FATAL' as const,
                    retry_count: count,
                    last_error: lastErrorFinal,
                    updated_at: new Date().toISOString(),
                    provider_error_code: result.error_code ?? null,
                    provider_error_category: result.provider_error_category ?? null,
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
            for (const { row, result } of updates) {
              if (result.status === 'COMPLETED') {
                attemptCompleted++;
                completed++;
              } else if (result.status === 'RETRY') {
                const count = (row.retry_count ?? 0) + 1;
                const isFatal = count >= 8 || result.provider_error_category === 'VALIDATION' || result.provider_error_category === 'AUTH';
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
                    status: 'FAILED' as const,
                    retry_count: count,
                    last_error: 'CIRCUIT_OPEN',
                    updated_at: new Date().toISOString(),
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
            for (const row of siteRows) {
              const count = (row.retry_count ?? 0) + 1;
              const isFatal = count >= 8;
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

        await syncQueueValuesFromCalls(siteIdUuid, rowsToProcess, prefix);

        const rowsWithValue = rowsToProcess.filter((r) => {
          const v = (r as { value_cents?: number | null }).value_cents;
          if (v == null || v === undefined) {
            logWarn('OCI_ROW_SKIP_NULL_VALUE', { queue_id: r.id, prefix });
            return false;
          }
          return true;
        });
        const adapter = getProvider(providerKey);
        const jobs = rowsWithValue.map(queueRowToConversionJob);
        let results: UploadResult[];
        try {
          results = await adapter.uploadConversions({ jobs, credentials });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await bulkUpdateQueueGrouped(
            rowsWithValue,
            (r) => r.id,
            (row) => {
              const count = (row.retry_count ?? 0) + 1;
              const isFinal = count >= MAX_RETRY_ATTEMPTS;
              const delay = nextRetryDelaySeconds(row.retry_count ?? 0);
              return isFinal
                ? {
                  status: 'FAILED' as const,
                  retry_count: count,
                  last_error: msg.slice(0, 1000),
                  updated_at: new Date().toISOString(),
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
            'Update RETRY/FAILED (cron adapter throw) failed'
          );
          for (const row of rowsWithValue) {
            const count = (row.retry_count ?? 0) + 1;
            const isFatal = count >= 8;
            if (isFatal) {
              failed++;
              groupFailed++;
            } else {
              retry++;
              groupRetry++;
            }
          }
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
              const isFatal = count >= 8 || result.provider_error_category === 'VALIDATION' || result.provider_error_category === 'AUTH';
              const delay = nextRetryDelaySeconds(count);
              const lastErr = (result.error_message ?? '').slice(0, 1000);
              return isFatal
                ? {
                  status: 'FATAL' as const,
                  retry_count: count,
                  last_error: lastErr,
                  updated_at: new Date().toISOString(),
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
        for (const { row, result } of cronUpdates) {
          if (result.status === 'COMPLETED') {
            completed++;
            groupCompleted++;
          } else if (result.status === 'RETRY') {
            const count = (row.retry_count ?? 0) + 1;
            const isFatal = count >= 8 || result.provider_error_category === 'VALIDATION' || result.provider_error_category === 'AUTH';
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
