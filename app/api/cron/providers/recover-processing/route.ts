/**
 * GET/POST /api/cron/providers/recover-processing — requeue jobs stuck in PROCESSING (e.g. worker crash).
 * Auth: requireCronAuth. Query: min_age_minutes=15 (default).
 * Vercel Cron sends GET; POST kept for manual/Bearer calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const DEFAULT_MIN_AGE_MINUTES = 15;

async function runRecover(req: NextRequest) {
  const minAge = Math.max(
    1,
    Math.min(
      60,
      parseInt(req.nextUrl.searchParams.get('min_age_minutes') ?? String(DEFAULT_MIN_AGE_MINUTES), 10) || DEFAULT_MIN_AGE_MINUTES
    )
  );

  const { data, error } = await adminClient.rpc('recover_stuck_offline_conversion_jobs', {
    p_min_age_minutes: minAge,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }

  const recovered = (data as number) ?? 0;
  return NextResponse.json(
    { ok: true, recovered },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runRecover(req);
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runRecover(req);
}
