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
import { logInfo, logWarn, logError } from '@/lib/logging/logger';
import { runOfflineConversionRunner } from '@/lib/oci/runner';
import { RedisOutageError } from '@/lib/providers/limits/semaphore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const LOG_PREFIX = '[google-ads-oci]';

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) {
    logWarn('GOOGLE_ADS_OCI_AUTH_FAILED', { message: 'Invalid or missing CRON_SECRET / x-vercel-cron' });
    return forbidden;
  }

  logInfo('GOOGLE_ADS_OCI_STARTED', {});

  let result;
  try {
    result = await runOfflineConversionRunner({
      mode: 'worker',
      providerKey: 'google_ads',
      logPrefix: LOG_PREFIX,
    });
  } catch (err) {
    if (err instanceof RedisOutageError) {
      logError('REDIS_OUTAGE_OCI_WORKER', { error: err.message });
      return NextResponse.json(
        { ok: false, error: 'REDIS_OUTAGE', detail: err.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    logError('GOOGLE_ADS_OCI_RUNNER_ERROR', { error: msg });
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }

  if (!result.ok) {
    logError('GOOGLE_ADS_OCI_RUNNER_ERROR', { error: result.error });
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }

  logInfo('GOOGLE_ADS_OCI_FINISHED', { processed: result.processed, completed: result.completed, failed: result.failed, retry: result.retry });
  return NextResponse.json(
    { ok: true, processed: result.processed, completed: result.completed, failed: result.failed, retry: result.retry },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}
