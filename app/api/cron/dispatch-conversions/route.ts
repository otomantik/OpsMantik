/**
 * GET/POST /api/cron/dispatch-conversions
 *
 * Sprint 1.5 cron: dispatches pending rows from the `conversions` table
 * to Google Ads API via googleAdsAdapter.
 *
 * Schedule: every 2 minutes (see vercel.json).
 * Auth: requireCronAuth (x-vercel-cron in prod; Bearer CRON_SECRET in dev).
 * Vercel Cron sends GET; POST kept for manual/Bearer calls.
 * Distributed lock (Redis) prevents overlapping runs when invoked via GET.
 *
 * Env required:
 *   GOOGLE_ADS_CREDENTIALS — JSON-stringified GoogleAdsCredentials object
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { processPendingConversions } from '@/lib/workers/conversion-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CRON_LOCK_TTL_SEC = 180; // 3 min — exceeds 2-min schedule to prevent overlap

async function run(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const opts: Record<string, unknown> = {};
    const batchParam = sp.get('batch_size');
    const workerParam = sp.get('worker_id');
    if (batchParam) opts.batchSize = Math.max(1, Math.min(200, parseInt(batchParam, 10)));
    if (workerParam) opts.workerId = workerParam;

    try {
        const result = await processPendingConversions(opts as { batchSize?: number; workerId?: string });

        return NextResponse.json(
            {
                ok: true,
                picked: result.picked,
                processed: result.processed,
                succeeded: result.succeeded,
                failed: result.failed,
                parked: result.parked,
            },
            { status: 200, headers: getBuildInfoHeaders() }
        );
    } catch (err: unknown) {
        const details = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
            { ok: false, error: details },
            { status: 500, headers: getBuildInfoHeaders() }
        );
    }
}

export async function GET(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;
    const acquired = await tryAcquireCronLock('dispatch-conversions', CRON_LOCK_TTL_SEC);
    if (!acquired) {
        return NextResponse.json(
            { ok: true, skipped: true, reason: 'lock_held' },
            { status: 200, headers: getBuildInfoHeaders() }
        );
    }
    try {
        return await run(req);
    } finally {
        await releaseCronLock('dispatch-conversions');
    }
}

export async function POST(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;
    return run(req);
}
