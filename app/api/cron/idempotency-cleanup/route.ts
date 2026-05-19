/**
 * @deprecated CUT-02D — Unscheduled (break-glass). See docs/architecture/SEAL/CRON_CONTRACT.md.
 * Replacement: `/api/cron/night-maintenance`
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logInfo, logError } from '@/lib/logging/logger';
import { recordCronHeartbeat } from '@/lib/cron/heartbeat';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import {
  assessLimitHit,
  logLimitHitAssessment,
  parseStorageCleanupParams,
} from '@/lib/storage/cleanup-kernel';
export const runtime = 'nodejs';

const BATCH_SIZE = 10_000;
const LOCK_KEY = 'idempotency-cleanup';
const LOCK_TTL_SEC = 600;

function getYearMonthUtcOffset(monthsAgo: number): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - monthsAgo;
  const year = m <= 0 ? y - Math.ceil(-m / 12) : y;
  const month = ((m % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

async function run(req: NextRequest) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const params = parseStorageCleanupParams(req, { batchLimit: BATCH_SIZE });

  const acquired = await tryAcquireCronLock(LOCK_KEY, LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { headers: getBuildInfoHeaders() }
    );
  }

  try {
    await recordCronHeartbeat({
      jobName: 'idempotency-cleanup',
      routePath: '/api/cron/idempotency-cleanup',
      status: 'RUNNING',
      startedAt,
    });

    const now = new Date();
    const cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const cutoffIso = cutoffDate.toISOString();

    if (cutoffDate.getTime() > now.getTime() - 89 * 24 * 60 * 60 * 1000) {
      logError('CLEANUP_SAFETY_TRIGGERED', { cutoffIso, now: now.toISOString() });
      return NextResponse.json(
        { error: 'Safety check failed: Calculated cutoff is too recent.' },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const keepAfterYearMonth = getYearMonthUtcOffset(2);
    logInfo('CLEANUP_START', { cutoffIso, dryRun: params.dryRun, keep_after_year_month: keepAfterYearMonth });

    let deletedCount = 0;

    if (params.dryRun) {
      const { count, error } = await adminClient
        .from('ingest_idempotency')
        .select('*', { count: 'exact', head: true })
        .lt('created_at', cutoffIso)
        .lte('year_month', keepAfterYearMonth);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500, headers: getBuildInfoHeaders() });
      }
      deletedCount = count ?? 0;
    } else {
      const { data: deleted, error } = await adminClient.rpc('delete_expired_idempotency_batch', {
        p_cutoff_iso: cutoffIso,
        p_batch_size: BATCH_SIZE,
      });

      if (error) {
        logError('CLEANUP_FAIL', { error: error.message });
        return NextResponse.json({ error: error.message }, { status: 500, headers: getBuildInfoHeaders() });
      }

      deletedCount = typeof deleted === 'number' ? deleted : 0;
      logLimitHitAssessment('idempotency-cleanup', assessLimitHit(deletedCount, BATCH_SIZE));
    }

    logInfo('CLEANUP_COMPLETE', { deleted: deletedCount, dryRun: params.dryRun });

    const partial = !params.dryRun && deletedCount >= BATCH_SIZE;
    await recordCronHeartbeat({
      jobName: 'idempotency-cleanup',
      routePath: '/api/cron/idempotency-cleanup',
      status: partial ? 'PARTIAL' : 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      rowsAffected: deletedCount,
    });

    return NextResponse.json(
      {
        ok: true,
        cutoff: cutoffIso,
        deleted: params.dryRun ? undefined : deletedCount,
        would_delete: params.dryRun ? deletedCount : undefined,
        dry_run: params.dryRun,
        batch_size: BATCH_SIZE,
        note:
          deletedCount >= BATCH_SIZE
            ? `Backlog may remain; run again or schedule more frequently.`
            : undefined,
      },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('IDEMPOTENCY_CLEANUP_ERROR', { error: msg });
    await recordCronHeartbeat({
      jobName: 'idempotency-cleanup',
      routePath: '/api/cron/idempotency-cleanup',
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      errorCode: 'IDEMPOTENCY_CLEANUP_FAILED',
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
  return run(req);
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return run(req);
}
