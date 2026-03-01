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
      .select('id, site_id, occurred_at, amount_cents, currency, conversation_id')
      .eq('status', 'CONFIRMED')
      .gte('occurred_at', since);

    if (salesError) {
      return NextResponse.json(
        { ok: false, error: salesError.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const { data: existingQueue } = await adminClient
      .from('offline_conversion_queue')
      .select('sale_id');
    const existingSaleIds = new Set((existingQueue ?? []).map((r) => r.sale_id));

    let enqueued = 0;
    let skipped = 0;

    for (const sale of sales ?? []) {
      if (existingSaleIds.has(sale.id)) {
        skipped++;
        continue;
      }

      let gclid: string | null = null;
      let wbraid: string | null = null;
      let gbraid: string | null = null;
      if (sale.conversation_id) {
        const { data: conv } = await adminClient
          .from('conversations')
          .select('primary_source')
          .eq('id', sale.conversation_id)
          .maybeSingle();
        const ps = conv?.primary_source as { gclid?: string; wbraid?: string; gbraid?: string } | null;
        if (ps) {
          gclid = ps.gclid ?? null;
          wbraid = ps.wbraid ?? null;
          gbraid = ps.gbraid ?? null;
        }
      }

      // V5_SEAL: value_cents = sale_amount exactly (or 0). No proxy multipliers; bypasses legacy oci_config.
      // sales.amount_cents is already in minor units — use as-is to match War Room output.
      const { error: insertError } = await adminClient
        .from('offline_conversion_queue')
        .insert({
          site_id: sale.site_id,
          sale_id: sale.id,
          conversion_time: sale.occurred_at,
          value_cents: sale.amount_cents ?? 0,
          currency: sale.currency,
          gclid,
          wbraid,
          gbraid,
          status: 'QUEUED',
        });

      if (insertError) {
        if (insertError.code === '23505') {
          skipped++;
          existingSaleIds.add(sale.id);
        } else {
          return NextResponse.json(
            { ok: false, error: insertError.message },
            { status: 500, headers: getBuildInfoHeaders() }
          );
        }
      } else {
        enqueued++;
        existingSaleIds.add(sale.id);
      }
    }

    const processed = sales?.length ?? 0;
    return NextResponse.json(
      { ok: true, processed, enqueued, skipped },
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
