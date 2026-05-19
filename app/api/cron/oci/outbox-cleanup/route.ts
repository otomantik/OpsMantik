/**
 * @deprecated CUT-02D — Unscheduled (break-glass). See docs/architecture/SEAL/CRON_CONTRACT.md.
 * Replacement: `/api/cron/night-maintenance`
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { recordCronHeartbeat } from '@/lib/cron/heartbeat';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logError, logInfo } from '@/lib/logging/logger';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import {
  assessLimitHit,
  logLimitHitAssessment,
  parseRpcAffected,
  parseStorageCleanupParams,
} from '@/lib/storage/cleanup-kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOCK_KEY = 'oci/outbox-cleanup';
const LOCK_TTL_SEC = 600;

async function handle(req: NextRequest) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const params = parseStorageCleanupParams(req, { batchLimit: 5000, days: 7 });

  const acquired = await tryAcquireCronLock(LOCK_KEY, LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { headers: getBuildInfoHeaders() }
    );
  }

  try {
    await recordCronHeartbeat({
      jobName: 'oci-outbox-cleanup',
      routePath: '/api/cron/oci/outbox-cleanup',
      status: 'RUNNING',
      startedAt,
    });

    const { data, error } = await adminClient.rpc('delete_outbox_processed_batch', {
      p_days_old: params.days ?? 7,
      p_limit: params.batchLimit,
      p_dry_run: params.dryRun,
    });
    if (error) throw error;

    const deleted = parseRpcAffected(data);
    logLimitHitAssessment('oci-outbox-cleanup', assessLimitHit(deleted, params.batchLimit));
    logInfo('OCI_OUTBOX_CLEANUP_RAN', { deleted, dry_run: params.dryRun });

    const partial = deleted >= params.batchLimit;
    await recordCronHeartbeat({
      jobName: 'oci-outbox-cleanup',
      routePath: '/api/cron/oci/outbox-cleanup',
      status: partial ? 'PARTIAL' : 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      rowsAffected: deleted,
      errorCode: partial ? 'BACKLOG_REMAINS' : null,
      errorMessage: partial ? 'Batch limit reached' : null,
    });

    return NextResponse.json(
      { ok: true, dry_run: params.dryRun, result: data },
      { headers: getBuildInfoHeaders() }
    );
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
