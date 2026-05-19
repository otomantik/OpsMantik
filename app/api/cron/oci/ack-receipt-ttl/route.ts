/**
 * @deprecated CUT-02C — Scheduled via `/api/cron/oci-maintenance` (`sweep_stale_ack_receipts_v1` step).
 * Break-glass only: manual GET/POST with `CRON_SECRET` or `x-vercel-cron`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { recordCronHeartbeat } from '@/lib/cron/heartbeat';
import { logError, logInfo } from '@/lib/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// L27: bounded sweep RPC (p_limit=500); 60s is generous.
export const maxDuration = 60;

async function handle() {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  await recordCronHeartbeat({
    jobName: 'oci-ack-receipt-ttl',
    routePath: '/api/cron/oci/ack-receipt-ttl',
    status: 'RUNNING',
    startedAt,
  });

  try {
    const { data, error } = await adminClient.rpc('sweep_stale_ack_receipts_v1', {
      p_min_age_minutes: 60,
      p_limit: 500,
    });
    if (error) throw error;
    const staleCount = typeof data === 'number' ? data : 0;
    logInfo('OCI_ACK_RECEIPT_TTL_RAN', { stale_count: staleCount });

    await recordCronHeartbeat({
      jobName: 'oci-ack-receipt-ttl',
      routePath: '/api/cron/oci/ack-receipt-ttl',
      status: 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      rowsAffected: staleCount,
    });

    return NextResponse.json({ ok: true, stale_count: staleCount }, { headers: getBuildInfoHeaders() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('OCI_ACK_RECEIPT_TTL_FAILED', { error: msg });
    await recordCronHeartbeat({
      jobName: 'oci-ack-receipt-ttl',
      routePath: '/api/cron/oci/ack-receipt-ttl',
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      errorCode: 'ACK_RECEIPT_TTL_FAILED',
      errorMessage: msg,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: getBuildInfoHeaders() });
  }
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return handle();
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return handle();
}
