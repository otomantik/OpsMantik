/**
 * GET/POST /api/cron/processed-signals-retention — stale fail + terminal delete (PR-C1).
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { recordCronHeartbeat } from '@/lib/cron/heartbeat';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { logError } from '@/lib/logging/logger';
import {
  assessLimitHit,
  logLimitHitAssessment,
  parseRpcAffected,
  parseStorageCleanupParams,
} from '@/lib/storage/cleanup-kernel';

export const runtime = 'nodejs';

const LOCK_KEY = 'processed-signals-retention';
const LOCK_TTL_SEC = 600;

async function handle(req: NextRequest) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const params = parseStorageCleanupParams(req, { batchLimit: 5000 });

  const acquired = await tryAcquireCronLock(LOCK_KEY, LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { headers: getBuildInfoHeaders() }
    );
  }

  try {
    await recordCronHeartbeat({
      jobName: 'processed-signals-retention',
      routePath: '/api/cron/processed-signals-retention',
      status: 'RUNNING',
      startedAt,
    });

    const { data: staleData, error: staleErr } = await adminClient.rpc('fail_stale_processed_signals_batch', {
      p_age_minutes: 31,
      p_limit: params.batchLimit,
      p_dry_run: params.dryRun,
    });
    if (staleErr) throw staleErr;

    const { data: deleteData, error: deleteErr } = await adminClient.rpc('delete_processed_signals_batch', {
      p_days_old: params.days ?? 90,
      p_limit: params.batchLimit,
      p_dry_run: params.dryRun,
    });
    if (deleteErr) throw deleteErr;

    const staleN = parseRpcAffected(staleData);
    const deleteN = parseRpcAffected(deleteData);
    logLimitHitAssessment(
      'processed-signals-retention',
      assessLimitHit(deleteN, params.batchLimit)
    );

    const partial = deleteN >= params.batchLimit;
    await recordCronHeartbeat({
      jobName: 'processed-signals-retention',
      routePath: '/api/cron/processed-signals-retention',
      status: partial ? 'PARTIAL' : 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      rowsAffected: staleN + deleteN,
    });

    return NextResponse.json(
      {
        ok: true,
        dry_run: params.dryRun,
        stale: staleData,
        deleted: deleteData,
      },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('PROCESSED_SIGNALS_RETENTION_FAIL', { error: msg });
    await recordCronHeartbeat({
      jobName: 'processed-signals-retention',
      routePath: '/api/cron/processed-signals-retention',
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      errorCode: 'RETENTION_FAILED',
      errorMessage: msg,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: getBuildInfoHeaders() });
  } finally {
    await releaseCronLock(LOCK_KEY);
  }
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return handle(req);
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return handle(req);
}
