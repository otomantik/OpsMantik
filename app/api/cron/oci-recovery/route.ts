import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { recordCronHeartbeat } from '@/lib/cron/heartbeat';
import { logError, logInfo } from '@/lib/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// L27: light recovery scan (limit 500); 60s is more than enough.
export const maxDuration = 60;

async function handle() {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  await recordCronHeartbeat({
    jobName: 'oci-recovery',
    routePath: '/api/cron/oci-recovery',
    status: 'RUNNING',
    startedAt,
  });

  try {
    const cutoffIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: stale, error: scanErr } = await adminClient
      .from('offline_conversion_queue')
      .select('id, site_id, action, claimed_at, attempt_count')
      .eq('status', 'PROCESSING')
      .lt('claimed_at', cutoffIso)
      .limit(500);

    if (scanErr) throw scanErr;

    const orphanCount = stale?.length ?? 0;
    if (orphanCount > 0) {
      logError('OCI_ORPHAN_CLAIM_DETECTED', {
        count: orphanCount,
        sample_sites: Array.from(new Set((stale ?? []).slice(0, 20).map((row) => row.site_id))),
      });
    }

    const { data: recovered, error: recoverErr } = await adminClient.rpc('recover_stuck_offline_conversion_jobs', {
      p_min_age_minutes: 30,
    });
    if (recoverErr) throw recoverErr;

    const recoveredCount = typeof recovered === 'number' ? recovered : 0;
    logInfo('OCI_RECOVERY_CRON_RAN', { orphan_detected: orphanCount, recovered_count: recoveredCount });

    await recordCronHeartbeat({
      jobName: 'oci-recovery',
      routePath: '/api/cron/oci-recovery',
      status: 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      rowsAffected: recoveredCount,
    });

    return NextResponse.json(
      { ok: true, orphan_detected: orphanCount, recovered: recoveredCount },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('OCI_RECOVERY_CRON_FAILED', { error: msg });
    await recordCronHeartbeat({
      jobName: 'oci-recovery',
      routePath: '/api/cron/oci-recovery',
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      errorCode: 'OCI_RECOVERY_FAILED',
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
