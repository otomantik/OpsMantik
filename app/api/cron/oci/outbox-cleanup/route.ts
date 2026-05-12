import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { recordCronHeartbeat } from '@/lib/cron/heartbeat';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logError, logInfo } from '@/lib/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// L27: single DELETE statement; never long-running.
export const maxDuration = 60;

async function handle() {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  await recordCronHeartbeat({
    jobName: 'oci-outbox-cleanup',
    routePath: '/api/cron/oci/outbox-cleanup',
    status: 'RUNNING',
    startedAt,
  });

  try {
    const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await adminClient
      .from('outbox_events')
      .delete()
      .eq('status', 'PROCESSED')
      .lt('processed_at', cutoffIso)
      .select('id');
    if (error) throw error;
    const deleted = data?.length ?? 0;
    logInfo('OCI_OUTBOX_CLEANUP_RAN', { deleted });
    await recordCronHeartbeat({
      jobName: 'oci-outbox-cleanup',
      routePath: '/api/cron/oci/outbox-cleanup',
      status: 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      rowsAffected: deleted,
    });
    return NextResponse.json({ ok: true, deleted }, { headers: getBuildInfoHeaders() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('OCI_OUTBOX_CLEANUP_FAILED', { error: msg });
    await recordCronHeartbeat({
      jobName: 'oci-outbox-cleanup',
      routePath: '/api/cron/oci/outbox-cleanup',
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      errorCode: 'OUTBOX_CLEANUP_FAILED',
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
