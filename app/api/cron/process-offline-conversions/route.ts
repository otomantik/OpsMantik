/**
 * GET/POST /api/cron/process-offline-conversions — claim and upload queued conversions (all or filtered providers).
 *
 * Uses single OCI runner (PR-C4): list groups → health gate → claim → upload → metrics + record_provider_outcome.
 * Query: provider_key? (optional), limit=50 (1..500).
 * Vercel Cron sends GET; POST kept for manual/Bearer calls.
 * Auth: requireCronAuth.
 * Distributed lock prevents overlapping runs (Redis SET NX EX).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { runOfflineConversionRunner } from '@/lib/oci/runner';
import { DEFAULT_LIMIT_CRON, MAX_LIMIT_CRON } from '@/lib/oci/constants';

export const runtime = 'nodejs';

const CRON_LOCK_TTL_SEC = 660; // 11 min — exceeds 10-min schedule to prevent overlap

async function runProcess(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const providerKeyParam = searchParams.get('provider_key')?.trim() || null;
  let limit = DEFAULT_LIMIT_CRON;
  const limitParam = searchParams.get('limit');
  if (limitParam != null && limitParam !== '') {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= MAX_LIMIT_CRON) {
      limit = parsed;
    }
  }

  const result = await runOfflineConversionRunner({
    mode: 'cron',
    providerFilter: providerKeyParam,
    limit,
    logPrefix: '[process-offline-conversions]',
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }

  return NextResponse.json(
    { ok: true, processed: result.processed, completed: result.completed, failed: result.failed, retry: result.retry },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  const acquired = await tryAcquireCronLock('process-offline-conversions', CRON_LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  try {
    const res = await runProcess(req);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  } finally {
    await releaseCronLock('process-offline-conversions');
  }
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runProcess(req);
}
