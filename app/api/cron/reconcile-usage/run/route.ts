/**
 * Revenue Kernel PR-4: Run reconciliation worker.
 * POST /api/cron/reconcile-usage/run — claims jobs with FOR UPDATE SKIP LOCKED, runs reconcile, updates status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';
import { reconcileUsageForMonth } from '@/lib/reconciliation';
import { logInfo, logError } from '@/lib/logging/logger';

export const runtime = 'nodejs';

const BATCH_SIZE = 50;

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  const requestId = req.headers.get('x-request-id') ?? undefined;
  let processed = 0;
  let completed = 0;
  let failed = 0;

  try {
    const { data: rows, error: rpcError } = await adminClient.rpc('claim_billing_reconciliation_jobs', {
      p_limit: BATCH_SIZE,
    });

    if (rpcError) {
      logError('BILLING_RECONCILE_CLAIM_ERROR', {
        code: 'BILLING_RECONCILE_FAILED',
        request_id: requestId,
        last_error: rpcError.message,
      });
      return NextResponse.json(
        { ok: false, error: 'Failed to claim jobs', details: rpcError.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const jobs = (rows ?? []) as { id: number; site_id: string; year_month: string }[];
    if (jobs.length === 0) {
      return NextResponse.json(
        { ok: true, processed: 0, completed: 0, failed: 0, request_id: requestId },
        { headers: getBuildInfoHeaders() }
      );
    }

    for (const job of jobs) {
      processed++;
      try {
        const result = await reconcileUsageForMonth(job.site_id, job.year_month);

        logInfo('BILLING_RECONCILE_OK', {
          code: 'BILLING_RECONCILE_OK',
          site_id: job.site_id,
          year_month: job.year_month,
          billable_count: result.pg_count_billable,
          overage_count: result.pg_count_overage,
          drift_abs: result.drift?.abs,
          drift_pct: result.drift?.pct,
          request_id: requestId,
        });

        await adminClient
          .from('billing_reconciliation_jobs')
          .update({
            status: 'COMPLETED',
            last_error: null,
            last_drift_pct: result.drift?.pct != null ? result.drift.pct : null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        completed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError('BILLING_RECONCILE_FAILED', {
          code: 'BILLING_RECONCILE_FAILED',
          site_id: job.site_id,
          year_month: job.year_month,
          last_error: message,
          request_id: requestId,
        });

        await adminClient
          .from('billing_reconciliation_jobs')
          .update({
            status: 'FAILED',
            last_error: message.slice(0, 1000),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        failed++;
      }
    }

    return NextResponse.json(
      { ok: true, processed, completed, failed, request_id: requestId },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    logError('BILLING_RECONCILE_FAILED', {
      code: 'BILLING_RECONCILE_FAILED',
      request_id: requestId,
      last_error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: 'Reconciliation run failed',
        details: err instanceof Error ? err.message : String(err),
        request_id: requestId,
      },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
