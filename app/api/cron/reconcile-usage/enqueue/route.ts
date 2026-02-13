/**
 * Revenue Kernel PR-4: Enqueue reconciliation jobs for active sites.
 * GET /api/cron/reconcile-usage/enqueue — cron auth required.
 * Active = sites with any ingest_idempotency in last 24h OR any row in current month.
 * UPSERT billing_reconciliation_jobs (current + previous month) ON CONFLICT DO NOTHING.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';
import { getCurrentYearMonthUTC } from '@/lib/reconciliation';

export const runtime = 'nodejs';

function previousYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  try {
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

    if (jobs.length === 0) {
      return NextResponse.json(
        { ok: true, enqueued: 0, message: 'No active sites' },
        { headers: getBuildInfoHeaders() }
      );
    }

    const { error } = await adminClient
      .from('billing_reconciliation_jobs')
      .upsert(jobs, { onConflict: 'site_id,year_month', ignoreDuplicates: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    return NextResponse.json(
      { ok: true, enqueued: jobs.length, active_sites: siteIds.size },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
