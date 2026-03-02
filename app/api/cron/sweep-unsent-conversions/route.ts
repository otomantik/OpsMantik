/**
 * GET/POST /api/cron/sweep-unsent-conversions
 *
 * Self-healing sweeper: finds calls that are oci_status = 'sealed' but not in
 * offline_conversion_queue (e.g. sealed via auto-approve cron or failed API).
 * Passes each through enqueueSealConversion() so OCI queue is filled without
 * manual DB intervention.
 *
 * Scope: last 7 days. Auth: requireCronAuth (Bearer CRON_SECRET / x-vercel-cron).
 * Vercel Cron sends GET; POST kept for manual/Bearer calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { adminClient } from '@/lib/supabase/admin';
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';

export const runtime = 'nodejs';

const LOOKBACK_DAYS = 7;
const MAX_ORPHANS_PER_RUN = 500;
const CRON_LOCK_TTL_SEC = 300; // 5 min — exceeds 15-min schedule

async function runSweep() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000);
  const sinceIso = since.toISOString();

  try {
    const [{ data: queueRows }, { data: sealedCalls, error: callsError }] = await Promise.all([
      adminClient.from('offline_conversion_queue').select('call_id').not('call_id', 'is', null),
      adminClient
        .from('calls')
        .select('id, site_id, confirmed_at, sale_amount, currency, lead_score')
        .eq('oci_status', 'sealed')
        .gte('confirmed_at', sinceIso)
        .not('confirmed_at', 'is', null)
        .order('confirmed_at', { ascending: false })
        .limit(MAX_ORPHANS_PER_RUN * 2),
    ]);

    if (callsError) {
      return NextResponse.json(
        { ok: false, error: callsError.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const queuedCallIds = new Set((queueRows ?? []).map((r) => r.call_id as string));
    const orphans = (sealedCalls ?? []).filter((c) => !queuedCallIds.has(c.id));

    let enqueued = 0;
    const skipped: Record<string, number> = {};
    const errors: string[] = [];

    for (const call of orphans.slice(0, MAX_ORPHANS_PER_RUN)) {
      const result = await enqueueSealConversion({
        callId: call.id,
        siteId: call.site_id,
        confirmedAt: call.confirmed_at!,
        saleAmount: call.sale_amount ?? null,
        currency: (call.currency?.trim() || 'TRY') as string,
        leadScore: call.lead_score ?? null,
      });

      if (result.enqueued) {
        enqueued++;
        queuedCallIds.add(call.id);
      } else {
        const reason = result.reason ?? 'error';
        skipped[reason] = (skipped[reason] ?? 0) + 1;
        if (result.error) errors.push(`${call.id}: ${result.error}`);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        orphaned: orphans.length,
        processed: Math.min(orphans.length, MAX_ORPHANS_PER_RUN),
        enqueued,
        skipped,
        errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
        since: sinceIso,
      },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg, code: 'SWEEP_UNSENT_CONVERSIONS_ERROR' },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}

async function handlerWithLock() {
  const acquired = await tryAcquireCronLock('sweep-unsent-conversions', CRON_LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  try {
    return await runSweep();
  } finally {
    await releaseCronLock('sweep-unsent-conversions');
  }
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return handlerWithLock();
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return handlerWithLock();
}
