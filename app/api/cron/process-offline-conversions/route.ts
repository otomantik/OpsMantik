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

  try {
    const { data: rows, error: claimError } = await adminClient.rpc('claim_offline_conversion_jobs_v2', {
      p_limit: limit,
      p_provider_key: providerKeyParam,
    });

    if (claimError) {
      return NextResponse.json(
        { ok: false, error: claimError.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const claimed = (rows ?? []) as QueueRow[];
    if (claimed.length === 0) {
      return NextResponse.json(
        { ok: true, processed: 0, completed: 0, failed: 0, retry: 0 },
        { status: 200, headers: getBuildInfoHeaders() }
      );
    }

    const bySiteAndProvider = new Map<string, QueueRow[]>();
    for (const row of claimed) {
      const key = `${row.site_id}:${row.provider_key}`;
      const list = bySiteAndProvider.get(key) ?? [];
      list.push(row);
      bySiteAndProvider.set(key, list);
    }

    let completed = 0;
    let failed = 0;
    let retry = 0;

    for (const [, siteRows] of bySiteAndProvider) {
      const first = siteRows[0];
      const siteId = first.site_id;
      const providerKey = first.provider_key;

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
          // Mark all in group as RETRY
          for (const row of siteRows) {
            const delay = nextRetryDelaySeconds(row.retry_count ?? 0);
            await adminClient
              .from('offline_conversion_queue')
              .update({
                status: 'RETRY',
                retry_count: (row.retry_count ?? 0) + 1,
                next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
                last_error: 'Failed to decrypt credentials',
                updated_at: new Date().toISOString(),
              })
              .eq('id', row.id);
            retry++;
          }
          continue;
        }
      }

      if (!credentials) {
        for (const row of siteRows) {
          const delay = nextRetryDelaySeconds(row.retry_count ?? 0);
          await adminClient
            .from('offline_conversion_queue')
            .update({
              status: 'RETRY',
              retry_count: (row.retry_count ?? 0) + 1,
              next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
              last_error: 'No credentials for site and provider',
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          retry++;
        }
        continue;
      }

      const adapter = getProvider(providerKey);
      const jobs = siteRows.map(queueRowToConversionJob);
      let results: { job_id: string; status: string; provider_ref?: string | null; error_message?: string | null }[];
      try {
        results = await adapter.uploadConversions({ jobs, credentials });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const row of siteRows) {
          const delay = nextRetryDelaySeconds(row.retry_count ?? 0);
          await adminClient
            .from('offline_conversion_queue')
            .update({
              status: 'RETRY',
              retry_count: (row.retry_count ?? 0) + 1,
              next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
              last_error: msg.slice(0, 1000),
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          retry++;
        }
        continue;
      }

      const rowById = new Map(siteRows.map((r) => [r.id, r]));
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
        } else if (result.status === 'RETRY') {
          const count = (row.retry_count ?? 0) + 1;
          const delay = nextRetryDelaySeconds(count);
          await adminClient
            .from('offline_conversion_queue')
            .update({
              status: 'RETRY',
              retry_count: count,
              next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
              last_error: (result.error_message ?? '').slice(0, 1000),
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          retry++;
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
        }
      }
    }

    return NextResponse.json(
      { ok: true, processed: claimed.length, completed, failed, retry },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
