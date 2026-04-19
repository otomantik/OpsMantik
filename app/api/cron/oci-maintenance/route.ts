/**
 * GET/POST /api/cron/oci-maintenance — Single-entry OCI self-healing cron.
 *
 * Replaces six legacy crons (sweep-zombies, recover-stuck-signals, attempt-cap,
 * sweep-unsent-conversions, pulse-recovery, providers/recover-processing). The
 * individual routes remain available for manual invocation / debugging but are
 * removed from `vercel.json`'s schedule list; only this route runs on a timer.
 *
 * Auth: requireCronAuth (Bearer CRON_SECRET / x-vercel-cron header).
 * Concurrency: distributed lock prevents overlapping runs if scheduler retries.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { runOciMaintenance } from '@/lib/oci/maintenance/run-maintenance';
import { logError } from '@/lib/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CRON_LOCK_KEY = 'oci-maintenance';
// 9 min — slightly below the next 10-min tick so the TTL releases cleanly if
// the cron crashes without reaching the finally block.
const CRON_LOCK_TTL_SEC = 540;

async function handle() {
  const acquired = await tryAcquireCronLock(CRON_LOCK_KEY, CRON_LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  try {
    const stats = await runOciMaintenance();
    const ok = stats.errors.length === 0;
    return NextResponse.json(
      { ok, stats },
      { status: ok ? 200 : 207, headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('OCI_MAINTENANCE_FATAL', { error: msg });
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  } finally {
    await releaseCronLock(CRON_LOCK_KEY);
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
