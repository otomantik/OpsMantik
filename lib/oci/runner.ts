import { createTenantClient } from '@/lib/supabase/tenant-client';
import { adminClient } from '@/lib/supabase/admin';
import { BATCH_SIZE_WORKER, DEFAULT_LIMIT_CRON, LIST_GROUPS_LIMIT, MAX_LIMIT_CRON } from '@/lib/oci/constants';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { decryptCredentials } from '@/lib/oci/runner/credentials';
import { bulkUpdateQueue } from '@/lib/oci/runner/queue-bulk-update';
import { logRunnerError } from '@/lib/oci/runner/log-helpers';
import { computeFairShareClaimLimits } from '@/lib/oci/runner/claim-planner';
import { writeProviderMetrics } from '@/lib/oci/runner/metrics-writer';
import { dispatchWorkerWave } from '@/lib/oci/runner/worker-wave';
import { dispatchCronClaimWave } from '@/lib/oci/runner/cron-wave';
import type { QueueRow } from '@/lib/cron/process-offline-conversions';
import type { ConversionGroupRow, ProviderCredentialsRow, ProviderHealthRow } from '@/lib/oci/runner/db-types';

export interface RunnerOptions {
  mode: 'worker' | 'cron';
  providerKey?: string;
  providerFilter?: string | null;
  limit?: number;
  logPrefix?: string;
}

export type RunnerResult =
  | { ok: true; processed: number; completed: number; failed: number; retry: number }
  | { ok: false; error: string };

export async function runOfflineConversionRunner(options: RunnerOptions): Promise<RunnerResult> {
  const { mode, providerKey: singleProviderKey, providerFilter, limit: optionLimit, logPrefix: prefix = '[oci-runner]' } = options;
  if (mode === 'worker' && !singleProviderKey) throw new Error('OCI runner: mode worker requires providerKey');

  const limit = mode === 'worker'
    ? BATCH_SIZE_WORKER
    : Math.min(MAX_LIMIT_CRON, Math.max(1, optionLimit ?? DEFAULT_LIMIT_CRON));
  const bySiteAndProvider = new Map<string, QueueRow[]>();
  const writtenMetricsKeys = new Set<string>();

  try {
    const filteredGroups = await listFilteredGroups(mode, singleProviderKey, providerFilter);
    if (filteredGroups.length === 0) return { ok: true, processed: 0, completed: 0, failed: 0, retry: 0 };

    const { healthByKey, claimLimits } = await planCronClaims(mode, filteredGroups, limit);
    await claimRows({ mode, prefix, limit, filteredGroups, bySiteAndProvider, healthByKey, claimLimits });

    const allClaimed = Array.from(bySiteAndProvider.values()).flat();
    if (allClaimed.length === 0) return { ok: true, processed: 0, completed: 0, failed: 0, retry: 0 };

    let completed = 0;
    let failed = 0;
    let retry = 0;

    for (const [key, siteRows] of bySiteAndProvider) {
      const first = siteRows[0];
      const siteIdUuid = first.site_id;
      const providerKey = first.provider_key;
      const credentials = await resolveCredentials(siteIdUuid, providerKey, siteRows, prefix);
      if (!credentials) {
        failed += siteRows.length;
        if (mode === 'cron') {
          await safeWriteProviderMetrics(siteIdUuid, providerKey, siteRows.length, 0, siteRows.length, 0, prefix);
          writtenMetricsKeys.add(key);
        }
        continue;
      }

      const result = mode === 'worker'
        ? await dispatchWorkerWave({ siteIdUuid, providerKey, siteRows, credentials, prefix })
        : await dispatchCronClaimWave({
            siteIdUuid,
            providerKey,
            siteRows,
            credentials,
            prefix,
            writeProviderMetrics: async (siteId, provKey, attempts, completedDelta, failedDelta, retryDelta) => {
              await safeWriteProviderMetrics(siteId, provKey, attempts, completedDelta, failedDelta, retryDelta, prefix);
              writtenMetricsKeys.add(`${siteId}:${provKey}`);
            },
          });

      completed += result.completed;
      failed += result.failed;
      retry += result.retry;
    }

    logInfo('OCI_RUN_COMPLETE', { prefix, mode, processed: allClaimed.length, completed, failed, retry });
    return { ok: true, processed: allClaimed.length, completed, failed, retry };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (mode === 'cron') {
      for (const [key, siteRows] of bySiteAndProvider) {
        if (writtenMetricsKeys.has(key)) continue;
        const first = siteRows[0];
        await safeWriteProviderMetrics(first.site_id, first.provider_key, siteRows.length, 0, 0, 0, prefix);
      }
    }
    return { ok: false, error: msg };
  }
}

async function listFilteredGroups(
  mode: RunnerOptions['mode'],
  singleProviderKey: string | undefined,
  providerFilter: string | null | undefined
): Promise<ConversionGroupRow[]> {
  const { data: groups, error: listError } = await adminClient.rpc('list_offline_conversion_groups', {
    p_limit_groups: LIST_GROUPS_LIMIT,
  });
  if (listError) throw listError;
  const groupList = (groups ?? []) as ConversionGroupRow[];
  if (mode === 'worker' && singleProviderKey) return groupList.filter((g) => g.provider_key === singleProviderKey);
  if (providerFilter) return groupList.filter((g) => g.provider_key === providerFilter);
  return groupList;
}

async function planCronClaims(
  mode: RunnerOptions['mode'],
  filteredGroups: ConversionGroupRow[],
  limit: number
): Promise<{ healthByKey: Map<string, ProviderHealthRow | null>; claimLimits: Map<string, number> }> {
  const healthByKey: Map<string, ProviderHealthRow | null> = new Map();
  const claimLimits = new Map<string, number>();
  if (mode !== 'cron') return { healthByKey, claimLimits };

  for (const g of filteredGroups) {
    const key = `${g.site_id}:${g.provider_key}`;
    const { data: healthRows } = await adminClient.rpc('get_provider_health_state', {
      p_site_id: g.site_id,
      p_provider_key: g.provider_key,
    });
    healthByKey.set(key, (healthRows as ProviderHealthRow[] | null)?.[0] ?? null);
  }
  const closedGroups = filteredGroups.filter((g) => (healthByKey.get(`${g.site_id}:${g.provider_key}`)?.state ?? 'CLOSED') === 'CLOSED');
  return { healthByKey, claimLimits: computeFairShareClaimLimits(closedGroups, limit) };
}

async function claimRows(input: {
  mode: RunnerOptions['mode'];
  prefix: string;
  limit: number;
  filteredGroups: ConversionGroupRow[];
  bySiteAndProvider: Map<string, QueueRow[]>;
  healthByKey: Map<string, ProviderHealthRow | null>;
  claimLimits: Map<string, number>;
}): Promise<void> {
  const { mode, prefix, limit, filteredGroups, bySiteAndProvider, healthByKey, claimLimits } = input;
  let remaining = limit;
  const maxGroups = Math.min(filteredGroups.length, 100);
  for (let i = 0; i < maxGroups && remaining > 0; i++) {
    const g = filteredGroups[i];
    const key = `${g.site_id}:${g.provider_key}`;
    if (mode === 'cron') {
      const health = healthByKey.get(key) ?? null;
      const state = health?.state ?? 'CLOSED';
      if (state === 'OPEN') continue;
      const probeLimit = health?.probe_limit ?? 5;
      const claimLimit = state === 'HALF_OPEN'
        ? Math.min(probeLimit, remaining)
        : Math.min(claimLimits.get(key) ?? Math.max(1, Math.floor(remaining / (maxGroups - i))), remaining);
      const { data: rows, error } = await adminClient.rpc('claim_offline_conversion_jobs_v3', {
        p_site_id: g.site_id,
        p_provider_key: g.provider_key,
        p_limit: claimLimit,
      });
      if (error) continue;
      const claimedRows = (rows ?? []) as QueueRow[];
      if (claimedRows.length === 0) continue;
      bySiteAndProvider.set(key, claimedRows);
      remaining -= claimedRows.length;
      continue;
    }

    const claimLimit = Math.min(remaining, Math.max(1, Number(g.queued_count ?? 0)));
    const { data: rows, error } = await adminClient.rpc('claim_offline_conversion_jobs_v3', {
      p_site_id: g.site_id,
      p_provider_key: g.provider_key,
      p_limit: claimLimit,
    });
    if (error) {
      logRunnerError(prefix, `claim failed for ${g.site_id}`, error);
      continue;
    }
    const claimedRows = (rows ?? []) as QueueRow[];
    if (claimedRows.length > 0) {
      bySiteAndProvider.set(key, claimedRows);
      remaining -= claimedRows.length;
    }
  }
}

async function resolveCredentials(
  siteIdUuid: string,
  providerKey: string,
  siteRows: QueueRow[],
  prefix: string
): Promise<unknown | null> {
  const tenantClient = createTenantClient(siteIdUuid);
  let encryptedPayload: string | null = null;
  try {
    const { data: credsData, error } = await tenantClient
      .from('provider_credentials')
      .select('encrypted_payload')
      .eq('provider_key', providerKey)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    encryptedPayload = (credsData as ProviderCredentialsRow | null)?.encrypted_payload ?? null;
  } catch (err) {
    logRunnerError(prefix, 'provider_credentials fetch failed', err);
  }

  if (!encryptedPayload) {
    await markCredentialsFailure(siteRows, prefix, 'Update FAILED (credentials) failed');
    return null;
  }
  try {
    return await decryptCredentials(encryptedPayload);
  } catch (err) {
    logRunnerError(prefix, 'Decrypt credentials failed', err);
    await markCredentialsFailure(siteRows, prefix, 'Update FAILED (decrypt) failed');
    return null;
  }
}

async function markCredentialsFailure(siteRows: QueueRow[], prefix: string, reason: string): Promise<void> {
  await bulkUpdateQueue(
    siteRows.map((r) => r.id),
    { status: 'FAILED', last_error: 'Credentials missing or decryption failed', updated_at: new Date().toISOString() },
    prefix,
    reason
  );
}

async function safeWriteProviderMetrics(
  siteId: string,
  providerKey: string,
  attempts: number,
  completed: number,
  failed: number,
  retry: number,
  prefix: string
): Promise<void> {
  try {
    await writeProviderMetrics({ siteId, providerKey, attempts, completed, failed, retry });
  } catch (e) {
    logWarn('OCI_increment_provider_upload_metrics_failed', { prefix, error: e instanceof Error ? e.message : String(e) });
  }
}

