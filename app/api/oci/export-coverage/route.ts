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
import { OCI_RECONCILIATION_REASONS } from '@/lib/oci/reconciliation-reasons';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RECONCILIATION_WINDOWS = {
  last_1h: 60 * 60 * 1000,
  last_24h: 24 * 60 * 60 * 1000,
  last_7d: 7 * 24 * 60 * 60 * 1000,
} as const;
type ReconciliationWindow = keyof typeof RECONCILIATION_WINDOWS;
const SIGNAL_DISPATCH_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED',
  'JUNK_ABORTED',
  'DEAD_LETTER_QUARANTINE',
  'SKIPPED_NO_CLICK_ID',
  'STALLED_FOR_HUMAN_AUDIT',
] as const;

function resolveReconciliationWindow(raw: string | null): ReconciliationWindow {
  if (!raw) return 'last_24h';
  if (raw === 'last_1h' || raw === 'last_24h' || raw === 'last_7d') return raw;
  return 'last_24h';
}

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
  const reconciliationWindow = resolveReconciliationWindow(searchParams.get('window'));

  const totals = Object.fromEntries(QUEUE_STATUSES.map((status) => [status, 0])) as Record<QueueStatus, number>;
  const signalDispatch: Record<string, number> = Object.fromEntries(
    SIGNAL_DISPATCH_STATUSES.map((status) => [status, 0])
  );

  const queueCountJobs = QUEUE_STATUSES.map(async (status) => {
    const { count, error } = await adminClient
      .from('offline_conversion_queue')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteUuid)
      .eq('status', status);
    if (error) throw error;
    totals[status] = typeof count === 'number' ? count : 0;
  });

  const signalCountJobs = SIGNAL_DISPATCH_STATUSES.map(async (status) => {
    const { count, error } = await adminClient
      .from('marketing_signals')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteUuid)
      .eq('dispatch_status', status);
    if (error) throw error;
    signalDispatch[status] = typeof count === 'number' ? count : 0;
  });

  try {
    await Promise.all([...queueCountJobs, ...signalCountJobs]);
  } catch {
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  }

  const since = new Date(Date.now() - RECONCILIATION_WINDOWS[reconciliationWindow]).toISOString();
  const { data: reconciliationRows, error: reconciliationErr } = await adminClient
    .from('oci_reconciliation_events')
    .select('reason')
    .eq('site_id', siteUuid)
    .gte('created_at', since);
  if (reconciliationErr) {
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  }
  const reconciliationByReason = Object.fromEntries(
    Object.values(OCI_RECONCILIATION_REASONS).map((reason) => [reason, 0])
  ) as Record<string, number>;
  for (const row of reconciliationRows ?? []) {
    const reason = String((row as { reason?: string | null }).reason ?? 'UNKNOWN');
    reconciliationByReason[reason] = (reconciliationByReason[reason] ?? 0) + 1;
  }
  const reconciliationCount = Object.values(reconciliationByReason).reduce((acc, n) => acc + n, 0);

  const exportSelectableQueue =
    totals.QUEUED + totals.RETRY;

  const orderingViolationRiskCount = totals.BLOCKED_PRECEDING_SIGNALS;

  return NextResponse.json({
    siteId: siteUuid,
    queueTotals: totals,
    exportSelectableQueue,
    marketingSignalsByDispatch: signalDispatch,
    reconciliationWindow,
    ociReconciliationEventCount: reconciliationCount,
    ociReconciliationEventsByReason: reconciliationByReason,
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
