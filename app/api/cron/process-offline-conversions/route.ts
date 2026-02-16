/**
 * POST /api/cron/process-offline-conversions — claim and upload queued conversions.
 * Auth: requireCronAuth. Query: provider_key? (optional), limit=50.
 * PR-G4: Worker loop.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';
import { getProvider } from '@/lib/providers/registry';
import {
  nextRetryDelaySeconds,
  queueRowToConversionJob,
  type QueueRow,
} from '@/lib/cron/process-offline-conversions';
export const runtime = 'nodejs';

async function decryptCredentials(ciphertext: string): Promise<unknown> {
  const vault = await import('@/lib/security/vault').catch(() => null);
  if (!vault?.decryptJson) throw new Error('Vault not configured');
  return vault.decryptJson(ciphertext);
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
/** After this many attempts, mark job FAILED instead of RETRY. */
const MAX_RETRY_ATTEMPTS = 7;

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  const searchParams = req.nextUrl.searchParams;
  const providerKeyParam = searchParams.get('provider_key')?.trim() || null;
  let limit = DEFAULT_LIMIT;
  const limitParam = searchParams.get('limit');
  if (limitParam != null && limitParam !== '') {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= MAX_LIMIT) {
      limit = parsed;
    }
  }

  const bySiteAndProvider: Map<string, QueueRow[]> = new Map();
  const writtenMetricsKeys: Set<string> = new Set();
  try {
    // PR6: Per-group claim via list_offline_conversion_groups + claim_offline_conversion_jobs_v2(site_id, provider_key, limit).
    const { data: groups, error: listError } = await adminClient.rpc('list_offline_conversion_groups', {
      p_limit_groups: 50,
    });
    if (listError) {
      return NextResponse.json(
        { ok: false, error: listError.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }
    const groupList = (groups ?? []) as { site_id: string; provider_key: string }[];
    const filteredGroups = providerKeyParam
      ? groupList.filter((g) => g.provider_key === providerKeyParam)
      : groupList;

    let remainingJobs = limit;
    const maxGroups = Math.min(filteredGroups.length, 100);
    for (let i = 0; i < maxGroups && remainingJobs > 0; i++) {
      const g = filteredGroups[i];
      const siteId = g.site_id;
      const providerKey = g.provider_key;

      type HealthRow = { state: string; next_probe_at: string | null; probe_limit: number };
      const { data: healthRows } = await adminClient.rpc('get_provider_health_state', {
        p_site_id: siteId,
        p_provider_key: providerKey,
      });
      const health: HealthRow | null = (healthRows as HealthRow[] | null)?.[0] ?? null;
      const state = health?.state ?? 'CLOSED';
      if (state === 'OPEN') continue;

      const probeLimit = health?.probe_limit ?? 5;
      const remainingGroups = maxGroups - i;
      // Enterprise guard: floor so no group starves others; min 1 to make progress.
      const fairShare = Math.max(1, Math.floor(remainingJobs / remainingGroups));
      const claimLimit =
        state === 'HALF_OPEN' ? Math.min(probeLimit, remainingJobs) : Math.min(fairShare, remainingJobs);

      const { data: rows, error: claimError } = await adminClient.rpc('claim_offline_conversion_jobs_v2', {
        p_site_id: siteId,
        p_provider_key: providerKey,
        p_limit: claimLimit,
      });
      if (claimError) continue;
      const claimedRows = (rows ?? []) as QueueRow[];
      if (claimedRows.length === 0) continue;

      remainingJobs -= claimedRows.length;
      const key = `${siteId}:${providerKey}`;
      bySiteAndProvider.set(key, claimedRows);
    }

    const claimed = Array.from(bySiteAndProvider.values()).flat();
    if (claimed.length === 0) {
      return NextResponse.json(
        { ok: true, processed: 0, completed: 0, failed: 0, retry: 0 },
        { status: 200, headers: getBuildInfoHeaders() }
      );
    }

    let completed = 0;
    let failed = 0;
    let retry = 0;

    async function writeProviderMetrics(
      siteId: string,
      providerKey: string,
      attempts: number,
      completedDelta: number,
      failedDelta: number,
      retryDelta: number
    ) {
      try {
        await adminClient.rpc('increment_provider_upload_metrics', {
          p_site_id: siteId,
          p_provider_key: providerKey,
          p_attempts_delta: attempts,
          p_completed_delta: completedDelta,
          p_failed_delta: failedDelta,
          p_retry_delta: retryDelta,
        });
        writtenMetricsKeys.add(`${siteId}:${providerKey}`);
      } catch (e) {
        console.warn('[process-offline-conversions] increment_provider_upload_metrics failed:', e);
      }
    }

    for (const [, siteRows] of bySiteAndProvider) {
      const first = siteRows[0];
      const siteId = first.site_id;
      const providerKey = first.provider_key;
      let groupCompleted = 0;
      let groupFailed = 0;
      let groupRetry = 0;

      let credentials: unknown = null;
      let encryptedPayload: string | null = null;
      try {
        const { data } = await adminClient
          .from('provider_credentials')
          .select('encrypted_payload')
          .eq('site_id', siteId)
          .eq('provider_key', providerKey)
          .eq('is_active', true)
          .maybeSingle();
        encryptedPayload = (data as { encrypted_payload?: string } | null)?.encrypted_payload ?? null;
      } catch {
        encryptedPayload = null;
      }

      if (encryptedPayload) {
        try {
          credentials = await decryptCredentials(encryptedPayload);
        } catch {
          // Missing or invalid credentials => FAILED (no retry; fix creds and re-enqueue manually if needed).
          groupFailed = siteRows.length;
          for (const row of siteRows) {
            await adminClient
              .from('offline_conversion_queue')
              .update({
                status: 'FAILED',
                last_error: 'Failed to decrypt credentials',
                updated_at: new Date().toISOString(),
              })
              .eq('id', row.id);
            failed++;
          }
          await writeProviderMetrics(siteId, providerKey, siteRows.length, 0, groupFailed, 0);
          continue;
        }
      }

      if (!credentials) {
        groupFailed = siteRows.length;
        for (const row of siteRows) {
          await adminClient
            .from('offline_conversion_queue')
            .update({
              status: 'FAILED',
              last_error: 'No credentials for site and provider',
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          failed++;
        }
        await writeProviderMetrics(siteId, providerKey, siteRows.length, 0, groupFailed, 0);
        continue;
      }

      // PR5: Circuit breaker — get health state (upserts default row if missing).
      type HealthRow = { state: string; next_probe_at: string | null; probe_limit: number };
      const { data: healthRows } = await adminClient.rpc('get_provider_health_state', {
        p_site_id: siteId,
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
                  : { status: 'RETRY', retry_count: count, next_retry_at: nextRetryAt, last_error: 'CIRCUIT_OPEN', updated_at: new Date().toISOString() }
              )
              .eq('id', row.id);
            if (isFinal) failed++;
            else retry++;
          }
          continue;
        }
        await adminClient.rpc('set_provider_state_half_open', { p_site_id: siteId, p_provider_key: providerKey });
      }

      let rowsToProcess = siteRows;
      if (state === 'HALF_OPEN') {
        const limit = Math.max(1, Math.min(probeLimit, siteRows.length));
        rowsToProcess = siteRows.slice(0, limit);
        const remainder = siteRows.slice(limit);
        for (const row of remainder) {
          await adminClient
            .from('offline_conversion_queue')
            .update({ status: 'QUEUED', next_retry_at: null, updated_at: new Date().toISOString() })
            .eq('id', row.id);
        }
      }

      const adapter = getProvider(providerKey);
      const jobs = rowsToProcess.map(queueRowToConversionJob);
      let results: { job_id: string; status: string; provider_ref?: string | null; error_message?: string | null }[];
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
        await writeProviderMetrics(siteId, providerKey, rowsToProcess.length, 0, groupFailed, groupRetry);
        try {
          await adminClient.rpc('record_provider_outcome', {
            p_site_id: siteId,
            p_provider_key: providerKey,
            p_is_success: false,
            p_is_transient: true,
          });
        } catch (e) {
          console.warn('[process-offline-conversions] record_provider_outcome failed:', e);
        }
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
      await writeProviderMetrics(siteId, providerKey, rowsToProcess.length, groupCompleted, groupFailed, groupRetry);
      try {
        await adminClient.rpc('record_provider_outcome', {
          p_site_id: siteId,
          p_provider_key: providerKey,
          p_is_success: groupCompleted > 0,
          p_is_transient: groupRetry > 0,
        });
      } catch (e) {
        console.warn('[process-offline-conversions] record_provider_outcome failed:', e);
      }
    }

    return NextResponse.json(
      { ok: true, processed: claimed.length, completed, failed, retry },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Guarantee metrics for groups not yet written (e.g. crash during a group).
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
          console.warn('[process-offline-conversions] crash-path increment_provider_upload_metrics failed:', e);
        }
      }
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
