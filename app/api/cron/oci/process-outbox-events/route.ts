/**
 * GET/POST /api/cron/oci/process-outbox-events
 *
 * Phase 1 Outbox worker (cron polling path): claims PENDING IntentSealed rows
 * and processes them. Real-time trigger path lives at
 * /api/workers/oci/process-outbox (QStash-signed). This cron remains the
 * safety-net backup in case a QStash publish is dropped / retried past its
 * deadline.
 *
 * Auth: requireCronAuth (Bearer CRON_SECRET / x-vercel-cron).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { runProcessOutbox } from '@/lib/oci/outbox/process-outbox';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';

export const runtime = 'nodejs';
const LOCK_KEY = 'oci-process-outbox-events';
const LOCK_TTL_SEC = 300;

function toHttpResponse(result: Awaited<ReturnType<typeof runProcessOutbox>>): NextResponse {
  const headers = getBuildInfoHeaders();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, code: 'PROCESS_OUTBOX_ERROR' },
      { status: 500, headers }
    );
  }
  if (result.message === 'no_pending_events') {
    return NextResponse.json(
      { ok: true, processed: 0, message: 'no_pending_events' },
      { status: 200, headers }
    );
  }
  return NextResponse.json(
    {
      ok: true,
      claimed: result.claimed,
      processed: result.processed,
      failed: result.failed,
      errors: result.errors,
    },
    { status: 200, headers }
  );
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  const acquired = await tryAcquireCronLock(LOCK_KEY, LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  try {
    const result = await runProcessOutbox();
    return toHttpResponse(result);
  } finally {
    await releaseCronLock(LOCK_KEY);
  }
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  const acquired = await tryAcquireCronLock(LOCK_KEY, LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  try {
    const result = await runProcessOutbox();
    return toHttpResponse(result);
  } finally {
    await releaseCronLock(LOCK_KEY);
  }
}
