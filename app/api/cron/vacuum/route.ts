/**
 * Phase 20: Vacuum cron — PENDING > 15m → STALLED_FOR_HUMAN_AUDIT.
 * Düsseldorf kill-switch: no gclid + non-TR geo → purge.
 * Run every 5–15 minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { runVacuum } from '@/lib/oci/vacuum-worker';
import { tryAcquireCronLock, releaseCronLock, startCronLockHeartbeat } from '@/lib/cron/with-cron-lock';

export const runtime = 'nodejs';
const LOCK_KEY = 'vacuum';
const LOCK_TTL_SEC = 300;

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return run();
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return run();
}

async function run() {
  const acquired = await tryAcquireCronLock(LOCK_KEY, LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  const stopHeartbeat = startCronLockHeartbeat(LOCK_KEY, LOCK_TTL_SEC);
  try {
    const result = await runVacuum();
    return NextResponse.json(
      { ok: true, ...result },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  } finally {
    stopHeartbeat?.();
    await releaseCronLock(LOCK_KEY);
  }
}
