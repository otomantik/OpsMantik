/**
 * Revenue Kernel PR-4.1: Unified reconciliation cron — single GET.
 * GET /api/cron/reconcile-usage — (1) enqueue jobs then (2) claim+run (limit 50).
 * Idempotent, safe for frequent schedules. Invoice SoT unchanged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';
import { getCurrentYearMonthUTC, reconcileUsageForMonth } from '@/lib/reconciliation';
import { logInfo, logError } from '@/lib/logging/logger';
import { incrementBillingReconciliationRunOk, incrementBillingReconciliationRunFailed } from '@/lib/billing-metrics';

export const runtime = 'nodejs';

const BATCH_SIZE = 50;

function previousYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  const requestId = req.headers.get('x-request-id') ?? undefined;
  let enqueued = 0;
  let processed = 0;
  let completed = 0;
  let failed = 0;

  try {
    // (1) Enqueue: active sites = ingest in last 24h OR current month
    const currentMonth = getCurrentYearMonthUTC();
    const prevMonth = previousYearMonth(currentMonth);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: currentRows } = await adminClient
      .from('ingest_idempotency')
      .select('site_id')
      .eq('year_month', currentMonth)
      .limit(10000);

    const { data: recentRows } = await adminClient
      .from('ingest_idempotency')
      .select('site_id')
      .gte('created_at', twentyFourHoursAgo)
      .limit(10000);

    const siteIds = new Set<string>();
    for (const r of currentRows ?? []) {
      if (r?.site_id) siteIds.add(r.site_id);
    }
    for (const r of recentRows ?? []) {
      if (r?.site_id) siteIds.add(r.site_id);
    }

    const jobs: { site_id: string; year_month: string }[] = [];
    for (const siteId of siteIds) {
      jobs.push({ site_id: siteId, year_month: currentMonth });
      jobs.push({ site_id: siteId, year_month: prevMonth });
    }

    if (jobs.length > 0) {
      const { error: upsertError } = await adminClient
        .from('billing_reconciliation_jobs')
        .upsert(jobs, { onConflict: 'site_id,year_month', ignoreDuplicates: true });
      if (!upsertError) enqueued = jobs.length;
    }

    // (2) Claim + run via RPC
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
        {
          ok: false,
          enqueued,
          processed: 0,
          completed: 0,
          failed: 0,
          request_id: requestId,
          error: 'Failed to claim jobs',
          details: rpcError.message,
        },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const claimedJobs = (rows ?? []) as { id: number; site_id: string; year_month: string }[];

    for (const job of claimedJobs) {
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
        incrementBillingReconciliationRunOk();
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
        incrementBillingReconciliationRunFailed();
        failed++;
      }
    }

    return NextResponse.json(
      { ok: true, enqueued, processed, completed, failed, request_id: requestId },
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
        enqueued,
        processed,
        completed,
        failed,
        request_id: requestId,
        error: 'Reconciliation failed',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
