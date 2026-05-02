/**
 * GET/POST /api/cron/oci/backfill-precursor-signals?siteId=...&limit=50&dry_run=1
 * Backfills missing OpsMantik_Contacted / OpsMantik_Offered rows for qualified/real/confirmed calls with click IDs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { logInfo } from '@/lib/logging/logger';
import { runPrecursorSignalBackfill } from '@/lib/oci/backfill-precursor-signals';

export const runtime = 'nodejs';

const CRON_LOCK_TTL_SEC = 900;

async function runBackfill(req: NextRequest) {
  const siteId = req.nextUrl.searchParams.get('siteId')?.trim();
  if (!siteId) {
    return NextResponse.json(
      { ok: false, error: 'siteId is required' },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  const limit = Math.max(1, Math.min(200, parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10) || 50));
  const dryRun =
    req.nextUrl.searchParams.get('dry_run') === '1' ||
    req.nextUrl.searchParams.get('dryRun') === '1';

  const result = await runPrecursorSignalBackfill({ siteId, limit, dryRun });

  if (result.inserted > 0 || result.upsertAttempts > 0) {
    logInfo('OCI_BACKFILL_PRECURSOR_SIGNALS', { siteId, dryRun, ...result });
  }

  return NextResponse.json({ ok: true, siteId, dryRun, ...result }, { status: 200, headers: getBuildInfoHeaders() });
}

async function handlerWithLock(req: NextRequest) {
  const acquired = await tryAcquireCronLock('oci/backfill-precursor-signals', CRON_LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  try {
    return await runBackfill(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: getBuildInfoHeaders() });
  } finally {
    await releaseCronLock('oci/backfill-precursor-signals');
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
