/**
 * GET/POST /api/cron/oci/promote-blocked-queue
 * Promotes BLOCKED_PRECEDING_SIGNALS → QUEUED when precursor signals are ready.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { logInfo } from '@/lib/logging/logger';
import { promoteBlockedQueueRows } from '@/lib/oci/promote-blocked-queue';

export const runtime = 'nodejs';

const CRON_LOCK_TTL_SEC = 600;

async function runPromote(req: NextRequest) {
  const limit = Math.max(
    1,
    Math.min(
      500,
      parseInt(req.nextUrl.searchParams.get('limit') ?? '200', 10) || 200
    )
  );

  const { scanned, promoted } = await promoteBlockedQueueRows(limit);

  if (promoted > 0) {
    logInfo('OCI_PROMOTE_BLOCKED_QUEUE', { scanned, promoted, limit });
  }

  return NextResponse.json(
    { ok: true, scanned, promoted, limit },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}

async function handlerWithLock(req: NextRequest) {
  const acquired = await tryAcquireCronLock('oci/promote-blocked-queue', CRON_LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  try {
    return await runPromote(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  } finally {
    await releaseCronLock('oci/promote-blocked-queue');
  }
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return handlerWithLock(req);
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return handlerWithLock(req);
}
