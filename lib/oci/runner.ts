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

import { adminClient } from '@/lib/supabase/admin';
import { getProvider } from '@/lib/providers/registry';
import type { UploadResult } from '@/lib/providers/types';
import {
  nextRetryDelaySeconds,
  queueRowToConversionJob,
  type QueueRow,
} from '@/lib/cron/process-offline-conversions';
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

function logError(prefix: string, message: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`${prefix} ${message}`, detail);
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
    logError(prefix, 'record_provider_outcome failed', e);
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
  console.log(
    `${prefix} mode=${mode} providerKey=${providerKey} claimed_count=${claimed_count} success_count=${success_count} failure_count=${failure_count} retry_count=${retry_count}`
  );
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
          logError(prefix, `claim failed for ${siteId}`, claimError);
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
        console.warn(`${prefix} increment_provider_upload_metrics failed:`, e);
      }
    }

    for (const [, siteRows] of bySiteAndProvider) {
      const first = siteRows[0];
      const siteIdUuid = first.site_id;
      const providerKey = first.provider_key;
      let groupCompleted = 0;
      let groupFailed = 0;
      let groupRetry = 0;

      let encryptedPayload: string | null = null;
      try {
        const { data, error: fetchErr } = await adminClient
          .from('provider_credentials')
          .select('encrypted_payload')
          .eq('site_id', siteIdUuid)
          .eq('provider_key', providerKey)
          .eq('is_active', true)
          .maybeSingle();
        if (fetchErr) throw fetchErr;
        encryptedPayload = (data as { encrypted_payload?: string } | null)?.encrypted_payload ?? null;
      } catch (err) {
        logError(prefix, 'provider_credentials fetch failed', err);
        encryptedPayload = null;
      }

      if (!encryptedPayload) {
        const lastError = 'Credentials missing or decryption failed';
        for (const row of siteRows) {
          const { error: updateErr } = await adminClient
            .from('offline_conversion_queue')
            .update({
              status: 'FAILED',
              last_error: lastError,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          if (updateErr) logError(prefix, 'Update FAILED (credentials) failed', updateErr);
          failed++;
        }
        if (mode === 'cron') await writeProviderMetrics(siteIdUuid, providerKey, siteRows.length, 0, siteRows.length, 0);
        continue;
      }

      let credentials: unknown;
      try {
        credentials = await decryptCredentials(encryptedPayload);
      } catch (err) {
        logError(prefix, 'Decrypt credentials failed', err);
        const lastError = 'Credentials missing or decryption failed';
        for (const row of siteRows) {
          const { error: updateErr } = await adminClient
            .from('offline_conversion_queue')
            .update({
              status: 'FAILED',
              last_error: lastError,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          if (updateErr) logError(prefix, 'Update FAILED (decrypt) failed', updateErr);
          failed++;
        }
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
          for (const row of siteRows) {
            const { error: updateErr } = await adminClient
              .from('offline_conversion_queue')
              .update({
                status: 'RETRY',
                next_retry_at: nextRetryAt,
                last_error: lastError,
                updated_at: new Date().toISOString(),
                provider_error_code: 'CONCURRENCY_LIMIT',
                provider_error_category: 'TRANSIENT',
              })
              .eq('id', row.id);
            if (updateErr) logError(prefix, 'Update RETRY (concurrency) failed', updateErr);
          }
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
            for (const row of siteRows) {
              const { error: updateErr } = await adminClient
                .from('offline_conversion_queue')
                .update({
                  status: 'RETRY',
                  next_retry_at: nextRetryAt,
                  last_error: lastError,
                  updated_at: new Date().toISOString(),
                  provider_error_code: 'CONCURRENCY_LIMIT',
                  provider_error_category: 'TRANSIENT',
                })
                .eq('id', row.id);
              if (updateErr) logError(prefix, 'Update RETRY (concurrency) failed', updateErr);
            }
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

        const adapter = getProvider(providerKey);
        const jobs = siteRows.map(queueRowToConversionJob);
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
          if (startedErr) logError(prefix, 'Ledger STARTED insert failed', startedErr);

          try {
            results = await adapter.uploadConversions({ jobs, credentials });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logError(prefix, 'Adapter uploadConversions threw', err);
            attemptErrorCode = null;
            attemptErrorCategory = 'TRANSIENT';
            for (const row of siteRows) {
              const count = (row.retry_count ?? 0) + 1;
              const isFinal = count >= MAX_RETRY_ATTEMPTS;
              const delaySec = nextRetryDelaySeconds(row.retry_count ?? 0);
              const lastErrorFinal = `Max retries reached: ${msg}`.slice(0, 1000);
              const updatePayload = isFinal
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
              const { error: updateErr } = await adminClient
                .from('offline_conversion_queue')
                .update(updatePayload)
                .eq('id', row.id);
              if (updateErr) logError(prefix, 'Update RETRY/FAILED after throw failed', updateErr);
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
            const rowById = new Map(siteRows.map((r) => [r.id, r]));
            for (const result of results) {
              const row = rowById.get(result.job_id);
              if (!row) continue;
              if (result.status === 'COMPLETED') {
                if (result.provider_request_id && attemptRequestId == null) attemptRequestId = result.provider_request_id;
                const updatePayload: Record<string, unknown> = {
                  status: 'COMPLETED',
                  last_error: null,
                  updated_at: new Date().toISOString(),
                  uploaded_at: new Date().toISOString(),
                  provider_request_id: result.provider_request_id ?? null,
                  provider_error_code: null,
                  provider_error_category: null,
                };
                if (result.provider_ref != null) updatePayload.provider_ref = result.provider_ref;
                const { error: updateErr } = await adminClient
                  .from('offline_conversion_queue')
                  .update(updatePayload)
                  .eq('id', row.id);
                if (updateErr) logError(prefix, 'Update COMPLETED failed', updateErr);
                attemptCompleted++;
                completed++;
              } else if (result.status === 'RETRY') {
                const count = (row.retry_count ?? 0) + 1;
                const isFinal = count >= MAX_RETRY_ATTEMPTS;
                const delaySec = nextRetryDelaySeconds(count);
                const errorMsg = result.error_message ?? 'Unknown error';
                const lastErrorFinal = isFinal ? `Max retries reached: ${errorMsg}`.slice(0, 1000) : errorMsg.slice(0, 1000);
                const updatePayload = isFinal
                  ? {
                      status: 'FAILED' as const,
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
                const { error: updateErr } = await adminClient
                  .from('offline_conversion_queue')
                  .update(updatePayload)
                  .eq('id', row.id);
                if (updateErr) logError(prefix, 'Update RETRY/FAILED (partial) failed', updateErr);
                if (isFinal) {
                  attemptFailed++;
                  failed++;
                } else {
                  attemptRetry++;
                  retry++;
                }
              } else {
                const lastError = (result.error_message ?? 'Unknown error').slice(0, 1000);
                const { error: updateErr } = await adminClient
                  .from('offline_conversion_queue')
                  .update({
                    status: 'FAILED',
                    last_error: lastError,
                    updated_at: new Date().toISOString(),
                    provider_error_code: result.error_code ?? null,
                    provider_error_category: result.provider_error_category ?? null,
                  })
                  .eq('id', row.id);
                if (updateErr) logError(prefix, 'Update FAILED (partial) failed', updateErr);
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
          if (finishedErr) logError(prefix, 'Ledger FINISHED insert failed', finishedErr);

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
            for (const row of siteRows) {
              const count = (row.retry_count ?? 0) + 1;
              const isFinal = count >= MAX_RETRY_ATTEMPTS;
              await adminClient
                .from('offline_conversion_queue')
                .update(
                  isFinal
                    ? { status: 'FAILED', retry_count: count, last_error: 'CIRCUIT_OPEN', updated_at: new Date().toISOString() }
                    : {
                        status: 'RETRY',
                        retry_count: count,
                        next_retry_at: nextRetryAt,
                        last_error: 'CIRCUIT_OPEN',
                        updated_at: new Date().toISOString(),
                      }
                )
                .eq('id', row.id);
              if (isFinal) failed++;
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
          for (const row of remainder) {
            await adminClient
              .from('offline_conversion_queue')
              .update({ status: 'QUEUED', next_retry_at: null, updated_at: new Date().toISOString() })
              .eq('id', row.id);
          }
        }

        const adapter = getProvider(providerKey);
        const jobs = rowsToProcess.map(queueRowToConversionJob);
        let results: UploadResult[];
        try {
          results = await adapter.uploadConversions({ jobs, credentials });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          for (const row of rowsToProcess) {
            const count = (row.retry_count ?? 0) + 1;
            const isFinal = count >= MAX_RETRY_ATTEMPTS;
            const delay = nextRetryDelaySeconds(row.retry_count ?? 0);
            await adminClient
              .from('offline_conversion_queue')
              .update(
                isFinal
                  ? {
                      status: 'FAILED',
                      retry_count: count,
                      last_error: msg.slice(0, 1000),
                      updated_at: new Date().toISOString(),
                    }
                  : {
                      status: 'RETRY',
                      retry_count: count,
                      next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
                      last_error: msg.slice(0, 1000),
                      updated_at: new Date().toISOString(),
                    }
              )
              .eq('id', row.id);
            if (isFinal) {
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

        const rowById = new Map(rowsToProcess.map((r) => [r.id, r]));
        for (const result of results) {
          const row = rowById.get(result.job_id);
          if (!row) continue;
          if (result.status === 'COMPLETED') {
            await adminClient
              .from('offline_conversion_queue')
              .update({
                status: 'COMPLETED',
                last_error: null,
                updated_at: new Date().toISOString(),
                ...(result.provider_ref != null && { provider_ref: result.provider_ref }),
              })
              .eq('id', row.id);
            completed++;
            groupCompleted++;
          } else if (result.status === 'RETRY') {
            const count = (row.retry_count ?? 0) + 1;
            const isFinal = count >= MAX_RETRY_ATTEMPTS;
            const delay = nextRetryDelaySeconds(count);
            await adminClient
              .from('offline_conversion_queue')
              .update(
                isFinal
                  ? {
                      status: 'FAILED',
                      retry_count: count,
                      last_error: (result.error_message ?? '').slice(0, 1000),
                      updated_at: new Date().toISOString(),
                    }
                  : {
                      status: 'RETRY',
                      retry_count: count,
                      next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
                      last_error: (result.error_message ?? '').slice(0, 1000),
                      updated_at: new Date().toISOString(),
                    }
              )
              .eq('id', row.id);
            if (isFinal) {
              failed++;
              groupFailed++;
            } else {
              retry++;
              groupRetry++;
            }
          } else {
            await adminClient
              .from('offline_conversion_queue')
              .update({
                status: 'FAILED',
                last_error: (result.error_message ?? '').slice(0, 1000),
                updated_at: new Date().toISOString(),
              })
              .eq('id', row.id);
            failed++;
            groupFailed++;
          }
        }
        await writeProviderMetrics(siteIdUuid, providerKey, rowsToProcess.length, groupCompleted, groupFailed, groupRetry);
        await persistProviderOutcome(siteIdUuid, providerKey, groupCompleted > 0, groupRetry > 0, prefix);
        logGroupOutcome(prefix, 'cron', providerKey, rowsToProcess.length, groupCompleted, groupFailed, groupRetry);
      }
    }

    console.log(
      `${prefix} run_complete mode=${mode} processed=${allClaimed.length} completed=${completed} failed=${failed} retry=${retry}`
    );
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
          console.warn(`${prefix} crash-path increment_provider_upload_metrics failed:`, e);
        }
      }
    }
    return { ok: false, error: msg };
  }
}
