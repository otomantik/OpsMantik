/**
 * GET/POST /api/cron/oci/enqueue-from-sales — enqueue CONFIRMED sales (last N hours) missing from queue.
 * Query param: hours (optional, default 24, max 168). Auth: requireCronAuth.
 * Vercel Cron sends GET (hourly); POST kept for manual/Bearer calls.
 * In-memory rate limit removed — serverless makes it ineffective; Vercel schedule + requireCronAuth sufficient.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const DEFAULT_HOURS = 24;
const MAX_HOURS = 168;

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runEnqueueFromSales(req);
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runEnqueueFromSales(req);
}

async function runEnqueueFromSales(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  let hours = DEFAULT_HOURS;
  const hoursParam = searchParams.get('hours');
  if (hoursParam != null && hoursParam !== '') {
    const parsed = parseInt(hoursParam, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > MAX_HOURS) {
      return NextResponse.json(
        { error: `hours must be between 1 and ${MAX_HOURS}`, received: hoursParam },
        { status: 400, headers: getBuildInfoHeaders() }
      );
    }
    hours = parsed;
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  try {
    const { data: sales, error: salesError } = await adminClient
      .from('sales')
      .select('id')
      .eq('status', 'CONFIRMED')
      .gte('occurred_at', since);

    if (salesError) {
      return NextResponse.json(
        { ok: false, error: salesError.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    let enqueued = 0;
    let skipped = 0;
    const reasons: Record<string, number> = {};

    for (const sale of sales ?? []) {
      const { data: reconcileRows, error: reconcileError } = await adminClient.rpc('reconcile_confirmed_sale_queue_v1', {
        p_sale_id: sale.id,
      });

      if (reconcileError) {
        return NextResponse.json(
          { ok: false, error: reconcileError.message, code: 'RECONCILE_CONFIRMED_SALE_QUEUE_FAILED' },
          { status: 500, headers: getBuildInfoHeaders() }
        );
      }

      const reconcile = Array.isArray(reconcileRows) ? reconcileRows[0] : reconcileRows;
      const didEnqueue = Boolean((reconcile as { enqueued?: boolean } | null)?.enqueued);
      const reason = ((reconcile as { reason?: string } | null)?.reason ?? 'unknown') as string;
      reasons[reason] = (reasons[reason] ?? 0) + 1;

      if (didEnqueue) {
        enqueued++;
      } else {
        skipped++;
      }
    }

    const processed = sales?.length ?? 0;
    return NextResponse.json(
      { ok: true, processed, enqueued, skipped, reasons },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = (err as { message?: string } | null)?.message ?? 'Internal error';
    return NextResponse.json(
      { ok: false, error: msg, code: 'ENQUEUE_FROM_SALES_INTERNAL' },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
