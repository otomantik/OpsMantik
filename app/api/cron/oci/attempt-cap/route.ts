/**
 * GET/POST /api/cron/oci/attempt-cap — mark rows with attempt_count >= MAX_ATTEMPTS as FAILED.
 * Auth: requireCronAuth. Query: max_attempts=5, min_age_minutes=0 (optional).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { logWarn } from '@/lib/logging/logger';
import { adminClient } from '@/lib/supabase/admin';
import { MAX_ATTEMPTS } from '@/lib/domain/oci/queue-types';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  try {
    return await runAttemptCap(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runAttemptCap(req);
}

async function runAttemptCap(req: NextRequest) {
  const maxAttempts = Math.max(
    1,
    Math.min(20, parseInt(req.nextUrl.searchParams.get('max_attempts') ?? String(MAX_ATTEMPTS), 10) || MAX_ATTEMPTS)
  );
  const minAgeMinutes = Math.max(
    0,
    Math.min(1440, parseInt(req.nextUrl.searchParams.get('min_age_minutes') ?? '0', 10) || 0)
  );

  const { data, error } = await adminClient.rpc('oci_attempt_cap', {
    p_max_attempts: maxAttempts,
    p_min_age_minutes: minAgeMinutes,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }

  const affected = (data as number) ?? 0;
  if (affected > 0) {
    logWarn('OCI_ATTEMPT_CAP_MARKED', { affected, max_attempts: maxAttempts });
  }
  return NextResponse.json(
    { ok: true, affected },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}
