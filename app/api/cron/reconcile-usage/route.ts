import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { BillingReconciliationService, type EnqueueResult, type ProcessResult } from '@/lib/services/billing-reconciliation';
import { logError } from '@/lib/logging/logger';

export const runtime = 'nodejs';

const CRON_LOCK_TTL_SEC = 600; // 10 min — exceeds 15-min schedule

/** Response shape for GET /api/cron/reconcile-usage */
interface ReconcileCronResponse {
    ok: boolean;
    request_id?: string;
    enqueue?: EnqueueResult;
    run?: ProcessResult;
}

/**
 * GET /api/cron/reconcile-usage
 * Unified reconciliation trigger.
 * Query Params:
 * - action: 'run' | 'enqueue' | undefined (runs both)
 * - limit: number (default 50, for 'run')
 */
export async function GET(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;

    const acquired = await tryAcquireCronLock('reconcile-usage', CRON_LOCK_TTL_SEC);
    if (!acquired) {
        return NextResponse.json(
            { ok: true, skipped: true, reason: 'lock_held' },
            { status: 200, headers: getBuildInfoHeaders() }
        );
    }

    try {
        const action = req.nextUrl.searchParams.get('action');
        const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10);
        const requestId = req.headers.get('x-request-id') ?? undefined;

        const result: ReconcileCronResponse = { ok: true, request_id: requestId };

        // 1. Enqueue
        if (!action || action === 'enqueue') {
            const enqueueRes = await BillingReconciliationService.enqueueActiveSites();
            result.enqueue = enqueueRes;
        }

        // 2. Run
        if (!action || action === 'run') {
            const processRes = await BillingReconciliationService.processPendingJobs(requestId, limit);
            result.run = processRes;
        }

        return NextResponse.json(result, { headers: getBuildInfoHeaders() });
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logError('RECONCILE_CRON_ERROR', {
            error: errorMsg,
            route: 'reconcile-usage',
        });
        return NextResponse.json(
            { ok: false, error: errorMsg },
            { status: 500, headers: getBuildInfoHeaders() }
        );
    } finally {
        await releaseCronLock('reconcile-usage');
    }
}
