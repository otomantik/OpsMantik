/**
 * Revenue Kernel PR-6: Invoice snapshot freeze.
 * POST /api/cron/invoice-freeze — freeze previous month (UTC) from site_usage_monthly.
 * Immutable: invoice_snapshot trigger blocks UPDATE/DELETE. ON CONFLICT DO NOTHING (idempotent).
 */

import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

function previousYearMonthUTC(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based: Jan=0, Feb=1, ...
  const prevM = m === 0 ? 11 : m - 1;
  const prevY = m === 0 ? y - 1 : y;
  return `${prevY}-${String(prevM + 1).padStart(2, '0')}`;
}

function snapshotHash(
  siteId: string,
  yearMonth: string,
  eventCount: number,
  overageCount: number,
  commitSha: string
): string {
  const payload = `${siteId}|${yearMonth}|${eventCount}|${overageCount}|${commitSha}`;
  return createHash('sha256').update(payload).digest('hex');
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  const requestId = req.headers.get('x-request-id') ?? undefined;
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || 'unknown';
  const generatedBy = 'invoice-freeze-cron';

  try {
    const yearMonth = previousYearMonthUTC();
    const generatedAt = new Date().toISOString();

    const { data: rows, error: selectError } = await adminClient
      .from('site_usage_monthly')
      .select('site_id, year_month, event_count, overage_count')
      .eq('year_month', yearMonth);

    if (selectError) {
      return NextResponse.json(
        { ok: false, error: selectError.message, request_id: requestId },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const snapshots = (rows ?? []).map((r: { site_id: string; year_month: string; event_count: number; overage_count: number }) => ({
      site_id: r.site_id,
      year_month: r.year_month,
      event_count: Number(r.event_count) ?? 0,
      overage_count: Number(r.overage_count) ?? 0,
      snapshot_hash: snapshotHash(
        r.site_id,
        r.year_month,
        Number(r.event_count) ?? 0,
        Number(r.overage_count) ?? 0,
        commitSha
      ),
      generated_at: generatedAt,
      generated_by: generatedBy,
    }));

    if (snapshots.length === 0) {
      return NextResponse.json(
        { ok: true, year_month: yearMonth, inserted: 0, skipped: 0, request_id: requestId },
        { headers: getBuildInfoHeaders() }
      );
    }

    const { data: inserted, error: insertError } = await adminClient
      .from('invoice_snapshot')
      .upsert(snapshots, { onConflict: 'site_id,year_month', ignoreDuplicates: true })
      .select('site_id');

    if (insertError) {
      return NextResponse.json(
        { ok: false, error: insertError.message, request_id: requestId },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const insertedCount = Array.isArray(inserted) ? inserted.length : 0;
    const skipped = snapshots.length - insertedCount;

    return NextResponse.json(
      {
        ok: true,
        year_month: yearMonth,
        inserted: insertedCount,
        skipped,
        total_sites: snapshots.length,
        request_id: requestId,
      },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        request_id: requestId,
      },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
