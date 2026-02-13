/**
 * Recovery worker for ingest_fallback_buffer.
 * Runs on cron (e.g. every 5 min); claims PENDING rows with FOR UPDATE SKIP LOCKED,
 * retries QStash publish; on success marks RECOVERED, on failure leaves PROCESSING for manual review or retry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';
import { qstash } from '@/lib/qstash/client';
import { logError, logInfo } from '@/lib/logging/logger';

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

    for (const row of rows as { id: string; site_id: string; payload: unknown; error_reason: string | null; created_at: string }[]) {
      try {
        await qstash.publishJSON({
          url: workerUrl,
          body: row.payload,
          retries: 3,
        });
        await adminClient
          .from('ingest_fallback_buffer')
          .update({ status: 'RECOVERED' })
          .eq('id', row.id);
        recovered++;
      } catch (err) {
        logError('RECOVER_FALLBACK_PUBLISH_FAILED', {
          request_id: requestId,
          fallback_id: row.id,
          site_id: row.site_id,
          error: String((err as Error)?.message ?? err),
        });
        // Leave as PROCESSING so next run can retry, or we could set back to PENDING
        await adminClient
          .from('ingest_fallback_buffer')
          .update({ status: 'PENDING', error_reason: String((err as Error)?.message ?? err).slice(0, 500) })
          .eq('id', row.id);
        failed++;
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
