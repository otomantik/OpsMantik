/**
 * GET/POST /api/cron/oci/recover-stuck-signals
 * Stuck-Signal-Recoverer: Resets marketing_signals stuck in PROCESSING (4h+)
 * back to PENDING so export can re-select them. Action item from docs/operations/OCI_OPERATIONS_SNAPSHOT.md.
 * Auth: requireCronAuth. Query: min_age_minutes=240 (default).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { logInfo } from '@/lib/logging/logger';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const DEFAULT_MIN_AGE_MINUTES = 240; // 4 hours — long-stuck signals
const CRON_LOCK_TTL_SEC = 900; // 15 min — exceeds schedule to prevent overlap

async function runRecover(req: NextRequest) {
  const minAge = Math.max(
    60,
    Math.min(
      10080, // max 7 days
      parseInt(req.nextUrl.searchParams.get('min_age_minutes') ?? String(DEFAULT_MIN_AGE_MINUTES), 10) ||
        DEFAULT_MIN_AGE_MINUTES
    )
  );

  const { data, error } = await adminClient.rpc('recover_stuck_marketing_signals', {
    p_min_age_minutes: minAge,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }

  const recovered = (data as number) ?? 0;
  if (recovered > 0) {
    logInfo('RECOVER_STUCK_SIGNALS', { recovered, min_age_minutes: minAge });
  }
  return NextResponse.json(
    { ok: true, recovered },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}

async function handlerWithLock(req: NextRequest) {
  const acquired = await tryAcquireCronLock('oci/recover-stuck-signals', CRON_LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  try {
    return await runRecover(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  } finally {
    await releaseCronLock('oci/recover-stuck-signals');
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
