/**
 * GET /api/oci/queue-stats?siteId=...
 * OCI Control: counts by status + stuck processing (processing older than 15 min).
 * Auth: session + validateSiteAccess (no cron secret).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireOciControlAuth } from '@/lib/oci/control-auth';
import type { OciQueueStats, QueueStatus } from '@/lib/domain/oci/queue-types';
import { QueueStatsQuerySchema, QUEUE_STATUSES } from '@/lib/domain/oci/queue-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STUCK_PROCESSING_MINUTES = 15;
const OUTBOX_STALE_MINUTES = 15;
const OUTBOX_FAILED_RECENT_HOURS = 24;

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

  const totals = Object.fromEntries(QUEUE_STATUSES.map((status) => [status, 0])) as Record<QueueStatus, number>;

  const { data: rows, error: countError } = await adminClient
    .from('offline_conversion_queue')
    .select('status')
    .eq('site_id', siteUuid);

  if (countError) {
    return NextResponse.json(
      { error: 'Something went wrong', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }

  for (const r of Array.isArray(rows) ? rows : []) {
    const s = (r as { status?: string }).status;
    if (s && QUEUE_STATUSES.includes(s as QueueStatus)) {
      totals[s as QueueStatus]++;
    }
  }

  const cutoff = new Date(Date.now() - STUCK_PROCESSING_MINUTES * 60 * 1000).toISOString();
  const { count: stuckCount, error: stuckError } = await adminClient
    .from('offline_conversion_queue')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteUuid)
    .eq('status', 'PROCESSING')
    .lt('updated_at', cutoff);

  let stuckProcessing: number | undefined;
  if (!stuckError && typeof stuckCount === 'number') {
    stuckProcessing = stuckCount;
  }

  const outboxStaleCutoff = new Date(Date.now() - OUTBOX_STALE_MINUTES * 60 * 1000).toISOString();
  const outboxFailedRecentCutoff = new Date(Date.now() - OUTBOX_FAILED_RECENT_HOURS * 60 * 60 * 1000).toISOString();
  const { count: outboxPendingCount } = await adminClient
    .from('outbox_events')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteUuid)
    .eq('status', 'PENDING');
  const { count: outboxStaleCount } = await adminClient
    .from('outbox_events')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteUuid)
    .eq('status', 'PROCESSING')
    .lt('updated_at', outboxStaleCutoff);
  const { count: outboxFailedRecentCount } = await adminClient
    .from('outbox_events')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteUuid)
    .eq('status', 'FAILED')
    .gte('updated_at', outboxFailedRecentCutoff);
  const { count: truthRepairBacklogCount } = await adminClient
    .from('truth_parity_repair_queue')
    .select('id', { count: 'exact', head: true })
    .in('status', ['PENDING', 'PROCESSING']);

  const { data: lastRow } = await adminClient
    .from('offline_conversion_queue')
    .select('updated_at')
    .eq('site_id', siteUuid)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastUpdatedAt = (lastRow as { updated_at?: string } | null)?.updated_at ?? undefined;
  const outboxPending = typeof outboxPendingCount === 'number' ? outboxPendingCount : 0;
  const outboxProcessingStale = typeof outboxStaleCount === 'number' ? outboxStaleCount : 0;
  const outboxFailedRecent = typeof outboxFailedRecentCount === 'number' ? outboxFailedRecentCount : 0;
  const truthRepairBacklog = typeof truthRepairBacklogCount === 'number' ? truthRepairBacklogCount : 0;
  const queueActive = totals.QUEUED + totals.RETRY + totals.PROCESSING + totals.UPLOADED;
  const outboxActive = outboxPending + outboxProcessingStale + outboxFailedRecent;
  const parityDenominator = Math.max(queueActive, outboxActive, 1);
  const outboxQueueParityRatio = Number((Math.min(queueActive, outboxActive) / parityDenominator).toFixed(4));

  const body: OciQueueStats = {
    siteId: siteUuid,
    totals,
    ...(stuckProcessing !== undefined && { stuckProcessing }),
    ...(lastUpdatedAt && { lastUpdatedAt }),
    outboxPending,
    outboxProcessingStale,
    outboxFailedRecent,
    truthRepairBacklog,
    outboxQueueParityRatio,
  };
  return NextResponse.json(body);
}
