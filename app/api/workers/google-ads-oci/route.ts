/**
 * POST /api/workers/google-ads-oci — Production worker for Google Ads Offline Conversion Import.
 *
 * Processes offline_conversion_queue via single OCI runner (PR-C4): list groups → claim → semaphore →
 * upload via Google Ads adapter → ledger + queue updates.
 *
 * Dependencies:
 * - Auth: requireCronAuth (Bearer CRON_SECRET or x-vercel-cron)
 * - lib/oci/runner: runOfflineConversionRunner({ mode: 'worker', providerKey: 'google_ads' })
 *
 * Next.js 16 App Router.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { runOfflineConversionRunner } from '@/lib/oci/runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const LOG_PREFIX = '[google-ads-oci]';

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) {
    console.log(`${LOG_PREFIX} Auth failed: invalid or missing Authorization Bearer CRON_SECRET / x-vercel-cron`);
    return forbidden;
  }

  console.log(`${LOG_PREFIX} Worker started`);

  const result = await runOfflineConversionRunner({
    mode: 'worker',
    providerKey: 'google_ads',
    logPrefix: LOG_PREFIX,
  });

  if (!result.ok) {
    console.error(`${LOG_PREFIX} Runner error`, result.error);
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }

  console.log(`${LOG_PREFIX} Worker finished`, result);
  return NextResponse.json(
    { ok: true, processed: result.processed, completed: result.completed, failed: result.failed, retry: result.retry },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}
