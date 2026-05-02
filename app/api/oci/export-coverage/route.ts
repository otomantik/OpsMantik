/**
 * GET /api/oci/export-coverage?siteId=...
 * SSOT-oriented snapshot: queue totals, marketing_signals dispatch breakdown,
 * blocked precursor backlog, reconciliation event volume (24h).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireOciControlAuth } from '@/lib/oci/control-auth';
import { EXPORT_COVERAGE_CLASS } from '@/lib/domain/oci/export-eligible-taxonomy';
import { QueueStatsQuerySchema, QUEUE_STATUSES, type QueueStatus } from '@/lib/domain/oci/queue-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parsed = QueueStatsQuerySchema.safeParse({
    siteId: searchParams.get('siteId') ?? '',
    scope: searchParams.get('scope') ?? 'site',
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await requireOciControlAuth(parsed.data.siteId);
  if (auth instanceof NextResponse) return auth;
  const siteUuid = auth.siteUuid;

  const totals = Object.fromEntries(QUEUE_STATUSES.map((status) => [status, 0])) as Record<
    QueueStatus,
    number
  >;

  const { data: queueRows, error: qErr } = await adminClient
    .from('offline_conversion_queue')
    .select('status')
    .eq('site_id', siteUuid);

  if (qErr) {
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  }

  for (const r of Array.isArray(queueRows) ? queueRows : []) {
    const s = (r as { status?: string }).status;
    if (s && QUEUE_STATUSES.includes(s as QueueStatus)) {
      totals[s as QueueStatus]++;
    }
  }

  const { data: signalRows } = await adminClient
    .from('marketing_signals')
    .select('dispatch_status')
    .eq('site_id', siteUuid);

  const signalDispatch: Record<string, number> = {};
  for (const sr of Array.isArray(signalRows) ? signalRows : []) {
    const d = (sr as { dispatch_status?: string }).dispatch_status ?? 'UNKNOWN';
    signalDispatch[d] = (signalDispatch[d] ?? 0) + 1;
  }

  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { count: reconciliation24h } = await adminClient
    .from('oci_reconciliation_events')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteUuid)
    .gte('created_at', since);

  const exportSelectableQueue =
    totals.QUEUED + totals.RETRY;

  const orderingViolationRiskCount = totals.BLOCKED_PRECEDING_SIGNALS;

  return NextResponse.json({
    siteId: siteUuid,
    queueTotals: totals,
    exportSelectableQueue,
    marketingSignalsByDispatch: signalDispatch,
    ociReconciliationEventsLast24h: typeof reconciliation24h === 'number' ? reconciliation24h : 0,
    coverageClassification: {
      [EXPORT_COVERAGE_CLASS.ORDERING_VIOLATION_RISK]: orderingViolationRiskCount,
    },
    notes: [
      'Export script/API only selects offline_conversion_queue rows in QUEUED or RETRY.',
      'BLOCKED_PRECEDING_SIGNALS waits for precursor marketing_signals to leave PENDING/PROCESSING/STALLED.',
      `${EXPORT_COVERAGE_CLASS.ORDERING_VIOLATION_RISK}: won row present but export deferred — not EXPORT_EXPECTED_BUT_MISSING.`,
    ],
  });
}
