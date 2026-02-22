/**
 * Recovery worker for ingest_fallback_buffer.
 * Runs on cron (e.g. every 5 min); claims PENDING rows with FOR UPDATE SKIP LOCKED,
 * retries QStash publish; on success marks RECOVERED, on failure leaves PENDING for retry.
 * Reduced O(N) DB round-trips to bulk updates; publishes run with concurrency limit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';
import { qstash } from '@/lib/qstash/client';
import { logError, logInfo } from '@/lib/logging/logger';
import { chunkArray, mapWithConcurrency } from '@/lib/utils/batch';

export const runtime = 'nodejs';

const BATCH_SIZE = 100;

function getWorkerBaseUrl(): string {
  const v = process.env.VERCEL_URL;
  if (v) return `https://${v}`;
  const app = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_PRIMARY_DOMAIN;
  if (app) return app.startsWith('http') ? app : `https://${app}`;
  return 'http://localhost:3000';
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  const requestId = req.headers.get('x-request-id') ?? undefined;
  let claimed = 0;
  let recovered = 0;
  let failed = 0;

  try {
    // Concurrency-safe: RPC uses FOR UPDATE SKIP LOCKED; marks rows PROCESSING
    const { data: rows, error: rpcError } = await adminClient.rpc('get_and_claim_fallback_batch', {
      p_limit: BATCH_SIZE,
    });

    if (rpcError) {
      logError('RECOVER_FALLBACK_RPC_ERROR', {
        code: 'RECOVER_FALLBACK_RPC_ERROR',
        request_id: requestId,
        error: rpcError.message,
      });
      return NextResponse.json(
        { ok: false, error: 'Failed to claim batch', details: rpcError.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { ok: true, claimed: 0, recovered: 0, failed: 0, request_id: requestId },
        { headers: getBuildInfoHeaders() }
      );
    }

    claimed = rows.length;
    const workerUrl = `${getWorkerBaseUrl()}/api/sync/worker`;
    const typedRows = rows as {
      id: string;
      site_id: string;
      payload: unknown;
      error_reason: string | null;
      created_at: string;
    }[];

    // Publish with concurrency limit; collect outcomes.
    const outcomes = await mapWithConcurrency(
      typedRows,
      async (row) => {
        try {
          await qstash.publishJSON({
            url: workerUrl,
            body: row.payload,
            retries: 3,
          });
          return { id: row.id, site_id: row.site_id, success: true as const };
        } catch (err) {
          const errMsg = String((err as Error)?.message ?? err);
          logError('RECOVER_FALLBACK_PUBLISH_FAILED', {
            request_id: requestId,
            fallback_id: row.id,
            site_id: row.site_id,
            error: errMsg,
          });
          return {
            id: row.id,
            site_id: row.site_id,
            success: false as const,
            error_reason: errMsg.slice(0, 500),
          };
        }
      },
      3
    );

    const recoveredIds: string[] = [];
    const failedUpdates: { id: string; error_reason: string }[] = [];
    for (const o of outcomes) {
      if (o.success) {
        recoveredIds.push(o.id);
        recovered++;
      } else {
        failedUpdates.push({ id: o.id, error_reason: o.error_reason });
        failed++;
      }
    }

    // Bulk update: RECOVERED (reduced O(N) to O(N/500))
    const recoveredChunks = chunkArray(recoveredIds, 500);
    const bulkStart = Date.now();
    for (const chunk of recoveredChunks) {
      const { error } = await adminClient
        .from('ingest_fallback_buffer')
        .update({ status: 'RECOVERED' })
        .in('id', chunk);
      if (error) {
        logError('RECOVER_FALLBACK_BULK_RECOVERED_FAILED', {
          request_id: requestId,
          chunk_size: chunk.length,
          first_id: chunk[0],
          error: error.message,
        });
      }
    }
    if (recoveredIds.length > 0 || failedUpdates.length > 0) {
      logInfo('RECOVER_FALLBACK_BULK', {
        request_id: requestId,
        recoveredIdsCount: recoveredIds.length,
        recoveredChunks: recoveredChunks.length,
        pendingIdsCount: failedUpdates.length,
        durationMs: Date.now() - bulkStart,
      });
    }

    // Bulk update: PENDING (group by error_reason for batching)
    const byError = new Map<string, string[]>();
    for (const { id, error_reason } of failedUpdates) {
      const ids = byError.get(error_reason);
      if (ids) ids.push(id);
      else byError.set(error_reason, [id]);
    }
    for (const [error_reason, ids] of byError) {
      for (const chunk of chunkArray(ids, 500)) {
        const { error } = await adminClient
          .from('ingest_fallback_buffer')
          .update({ status: 'PENDING', error_reason })
          .in('id', chunk);
        if (error) {
          logError('RECOVER_FALLBACK_BULK_PENDING_FAILED', {
            request_id: requestId,
            chunk_size: chunk.length,
            first_id: chunk[0],
            error: error.message,
          });
        }
      }
    }

    logInfo('RECOVER_FALLBACK_OK', {
      request_id: requestId,
      claimed,
      recovered,
      failed,
    });

    return NextResponse.json(
      {
        ok: true,
        claimed,
        recovered,
        failed,
        request_id: requestId,
      },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    logError('RECOVER_FALLBACK_ERROR', {
      request_id: requestId,
      error: String((err as Error)?.message ?? err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: 'Recovery failed',
        details: err instanceof Error ? err.message : String(err),
        request_id: requestId,
      },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
