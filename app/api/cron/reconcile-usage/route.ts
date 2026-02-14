import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { BillingReconciliationService } from '@/lib/services/billing-reconciliation';
import { logError } from '@/lib/logging/logger';

export const runtime = 'nodejs';

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

    const action = req.nextUrl.searchParams.get('action');
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10);
    const requestId = req.headers.get('x-request-id') ?? undefined;

    const result: any = { ok: true, request_id: requestId };

    try {
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
        logError('RECONCILE_CRON_ERROR', { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500, headers: getBuildInfoHeaders() }
        );
    }
}
