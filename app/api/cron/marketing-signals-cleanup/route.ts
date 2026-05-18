/**
 * GET/POST /api/cron/marketing-signals-cleanup — SENT row retention (PR-C3).
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

const LOCK_KEY = 'marketing-signals-cleanup';
const LOCK_TTL_SEC = 600;

async function handle(req: NextRequest) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const params = parseStorageCleanupParams(req, { batchLimit: 5000, days: 60 });

  const acquired = await tryAcquireCronLock(LOCK_KEY, LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { headers: getBuildInfoHeaders() }
    );
  }

  try {
    await recordCronHeartbeat({
      jobName: 'marketing-signals-cleanup',
      routePath: '/api/cron/marketing-signals-cleanup',
      status: 'RUNNING',
      startedAt,
    });

    const { data, error } = await adminClient.rpc('cleanup_marketing_signals_batch', {
      p_days_old: params.days ?? 60,
      p_limit: params.batchLimit,
      p_dry_run: params.dryRun,
    });
    if (error) throw error;

    const affected = parseRpcAffected(data);
    logLimitHitAssessment('marketing-signals-cleanup', assessLimitHit(affected, params.batchLimit));

    const { data: truthData, error: truthErr } = await adminClient.rpc('delete_truth_evidence_batch', {
      p_days_old: 90,
      p_limit: params.batchLimit,
      p_dry_run: params.dryRun,
    });
    if (truthErr) throw truthErr;

    const truthAffected = parseRpcAffected(truthData);
    const partial = affected >= params.batchLimit;

    await recordCronHeartbeat({
      jobName: 'marketing-signals-cleanup',
      routePath: '/api/cron/marketing-signals-cleanup',
      status: partial ? 'PARTIAL' : 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      rowsAffected: affected + truthAffected,
    });

    return NextResponse.json(
      {
        ok: true,
        dry_run: params.dryRun,
        marketing_signals: data,
        truth_evidence: truthData,
      },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('MARKETING_SIGNALS_CLEANUP_FAIL', { error: msg });
    await recordCronHeartbeat({
      jobName: 'marketing-signals-cleanup',
      routePath: '/api/cron/marketing-signals-cleanup',
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      errorCode: 'CLEANUP_FAILED',
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
