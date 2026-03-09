/**
 * GET/POST /api/cron/funnel-repair
 *
 * Funnel Kernel Repair: For sealed calls (in queue) missing V2 in ledger,
 * append V2_SYNTHETIC so projection can reach complete. KPI-tracked, non-blocking.
 * Auth: requireCronAuth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';
import { appendFunnelEvent } from '@/lib/domain/funnel-kernel/ledger-writer';
import { logInfo, logError, logWarn } from '@/lib/logging/logger';

export const runtime = 'nodejs';

const BATCH_LIMIT = 50;

async function runFunnelRepair() {
  try {
    // Find queue rows (QUEUED/RETRY) whose call_id has no V2 in ledger
    const { data: queueRows, error: queueErr } = await adminClient
      .from('offline_conversion_queue')
      .select('id, call_id, site_id, conversion_time')
      .in('status', ['QUEUED', 'RETRY'])
      .eq('provider_key', 'google_ads')
      .limit(BATCH_LIMIT * 2);

    if (queueErr || !queueRows?.length) {
      return NextResponse.json(
        { ok: true, repaired: 0, skipped: 0, message: 'no_candidates' },
        { status: 200, headers: getBuildInfoHeaders() }
      );
    }

    const callIds = [...new Set((queueRows as { call_id: string }[]).map((r) => r.call_id).filter(Boolean))];
    const { data: ledgerV2 } = await adminClient
      .from('call_funnel_ledger')
      .select('call_id')
      .in('event_type', ['V2_CONTACT', 'V2_SYNTHETIC'])
      .in('call_id', callIds);

    const hasV2 = new Set((ledgerV2 ?? []).map((r: { call_id: string }) => r.call_id));

    let repaired = 0;
    let skipped = 0;

    for (const row of queueRows as { id: string; call_id: string; site_id: string; conversion_time?: string }[]) {
      const callId = row.call_id;
      const siteId = row.site_id;
      if (!callId || !siteId) continue;
      if (hasV2.has(callId)) {
        skipped++;
        continue;
      }

      try {
        const occurredAt = row.conversion_time
          ? new Date(row.conversion_time)
          : new Date();
        const result = await appendFunnelEvent({
          callId,
          siteId,
          eventType: 'V2_SYNTHETIC',
          eventSource: 'REPAIR',
          idempotencyKey: `v2:repair:${callId}:queue:${row.id}`,
          occurredAt,
          payload: { repair_source: 'funnel_repair_cron', queue_id: row.id },
        });
        if (result.appended) {
          repaired++;
          logInfo('funnel_repair_v2_synthetic_appended', { call_id: callId, queue_id: row.id });
        }
      } catch (err) {
        logWarn('funnel_repair_append_failed', {
          call_id: callId,
          queue_id: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logInfo('funnel_repair_cron_done', { repaired, skipped, candidates: queueRows.length });

    return NextResponse.json(
      { ok: true, repaired, skipped, candidates: queueRows.length },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('funnel_repair_cron_error', { error: msg });
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runFunnelRepair();
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runFunnelRepair();
}
