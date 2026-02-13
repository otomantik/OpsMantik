/**
 * Revenue Kernel: Backfill reconciliation jobs for a date range.
 * POST /api/cron/reconcile-usage/backfill
 * Auth: requireCronAuth
 * Body: { site_id?: uuid, from: 'YYYY-MM', to: 'YYYY-MM' }
 * Enqueues missing jobs (UPSERT DO NOTHING) for each month in range; single site or all sites with activity in range.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const YEAR_MONTH_REGEX = /^\d{4}-\d{2}$/;
const MAX_MONTHS = 12;

function parseYearMonth(s: string): { y: number; m: number } | null {
  if (!YEAR_MONTH_REGEX.test(s)) return null;
  const [y, m] = s.split('-').map(Number);
  if (m < 1 || m > 12) return null;
  return { y, m };
}

function monthsBetween(from: string, to: string): string[] {
  const f = parseYearMonth(from);
  const t = parseYearMonth(to);
  if (!f || !t) return [];
  const out: string[] = [];
  let y = f.y;
  let m = f.m;
  const endY = t.y;
  const endM = t.m;
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (m === 12) {
      y++;
      m = 1;
    } else {
      m++;
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  try {
    let body: { site_id?: string; from?: string; to?: string } = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400, headers: getBuildInfoHeaders() }
      );
    }

    const from = typeof body.from === 'string' ? body.from.trim() : '';
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    const siteId = typeof body.site_id === 'string' ? body.site_id.trim() : undefined;

    if (!from || !to) {
      return NextResponse.json(
        { error: 'Body must include from and to (YYYY-MM)' },
        { status: 400, headers: getBuildInfoHeaders() }
      );
    }

    const months = monthsBetween(from, to);
    if (months.length === 0) {
      return NextResponse.json(
        { error: 'Invalid from or to; use YYYY-MM with from <= to' },
        { status: 400, headers: getBuildInfoHeaders() }
      );
    }

    if (months.length > MAX_MONTHS) {
      return NextResponse.json(
        { error: `Date range must be at most ${MAX_MONTHS} months` },
        { status: 400, headers: getBuildInfoHeaders() }
      );
    }

    let siteIds: string[];
    if (siteId) {
      siteIds = [siteId];
    } else {
      const { data: rows } = await adminClient
        .from('ingest_idempotency')
        .select('site_id')
        .gte('year_month', from)
        .lte('year_month', to)
        .limit(50000);

      const set = new Set<string>();
      for (const r of rows ?? []) {
        if (r?.site_id) set.add(r.site_id);
      }
      siteIds = Array.from(set);
    }

    const jobs: { site_id: string; year_month: string }[] = [];
    for (const sid of siteIds) {
      for (const yearMonth of months) {
        jobs.push({ site_id: sid, year_month: yearMonth });
      }
    }

    if (jobs.length === 0) {
      return NextResponse.json(
        { ok: true, enqueued: 0, months, sites: siteIds.length },
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
      { ok: true, enqueued: jobs.length, months, sites: siteIds.length },
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
