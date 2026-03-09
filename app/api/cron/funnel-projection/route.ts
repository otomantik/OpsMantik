/**
 * GET/POST /api/cron/funnel-projection
 *
 * Funnel Kernel: processes call_funnel_ledger events and updates call_funnel_projection.
 * Batch/cron based — deterministic reducer order per PROJECTION_REDUCER_SPEC.
 * Auth: requireCronAuth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';
import { processCallProjection } from '@/lib/domain/funnel-kernel/projection-updater';
import { logInfo, logError } from '@/lib/logging/logger';

export const runtime = 'nodejs';

const BATCH_LIMIT = 100;

async function runProcessFunnelProjection() {
  try {
    // Fetch distinct (call_id, site_id) from ledger that have events not yet in projection
    // or projection exists but might need refresh from new ledger events.
    const { data: ledgerCalls, error: ledgerErr } = await adminClient
      .from('call_funnel_ledger')
      .select('call_id, site_id')
      .order('created_at', { ascending: false })
      .limit(BATCH_LIMIT * 2); // oversample for dedup

    if (ledgerErr) {
      logError('funnel_projection_ledger_fetch_failed', { error: ledgerErr.message });
      return NextResponse.json(
        { ok: false, error: ledgerErr.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const rows = Array.isArray(ledgerCalls) ? ledgerCalls : [];
    const seen = new Set<string>();
    const toProcess: { callId: string; siteId: string }[] = [];
    for (const r of rows) {
      const key = `${(r as { call_id: string }).call_id}:${(r as { site_id: string }).site_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        toProcess.push({
          callId: (r as { call_id: string }).call_id,
          siteId: (r as { site_id: string }).site_id,
        });
      }
      if (toProcess.length >= BATCH_LIMIT) break;
    }

    let processed = 0;
    let failed = 0;

    for (const { callId, siteId } of toProcess) {
      try {
        await processCallProjection(callId, siteId);
        processed++;
      } catch (err) {
        failed++;
        logError('funnel_projection_process_failed', {
          call_id: callId,
          site_id: siteId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logInfo('funnel_projection_cron_done', { processed, failed, batch: toProcess.length });

    return NextResponse.json(
      {
        ok: true,
        processed,
        failed,
        batch_size: toProcess.length,
      },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('funnel_projection_cron_error', { error: msg });
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runProcessFunnelProjection();
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runProcessFunnelProjection();
}
