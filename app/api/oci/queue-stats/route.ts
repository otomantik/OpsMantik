/**
 * GET /api/oci/queue-stats?siteId=...
 * OCI Control: counts by status + stuck processing (processing older than 15 min).
 * Auth: session + validateSiteAccess (no cron secret).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireOciControlAuth } from '@/lib/oci/control-auth';
import { computeBlockedQueueMetrics } from '@/lib/oci/blocked-queue-metrics';
import { STUCK_PROCESSING_MAX_AGE_MINUTES, evaluateQueueHealth } from '@/lib/oci/queue-health-contract';
import { countWonMissingPipelineForSite } from '@/lib/oci/won-missing-pipeline-site';
import { fetchSiteSsotFlags } from '@/lib/oci/queue-health-ssot-flags-site';
import type {
  OciQueueStats,
  QueueStatus,
} from '@/lib/domain/oci/queue-types';
import { QueueStatsQuerySchema, QUEUE_STATUSES } from '@/lib/domain/oci/queue-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STUCK_PROCESSING_MINUTES = STUCK_PROCESSING_MAX_AGE_MINUTES;
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

  const { data: siteMeta } = await adminClient
    .from('sites')
    .select('oci_sync_method')
    .eq('id', siteUuid)
    .maybeSingle();
  const ociSyncMethod =
    (siteMeta as { oci_sync_method?: string } | null)?.oci_sync_method?.trim() || 'script';

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
    .or(`processing_started_at.lt.${outboxStaleCutoff},and(processing_started_at.is.null,updated_at.lt.${outboxStaleCutoff})`);
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

  const blockedMetrics = await computeBlockedQueueMetrics(siteUuid);

  const [
    { data: oldestQueuedRow },
    { data: oldestRetryRow },
    { data: oldestProcessingRow },
    wonMissingPipelineCount,
    ssotFlags,
  ] = await Promise.all([
    adminClient
      .from('offline_conversion_queue')
      .select('created_at')
      .eq('site_id', siteUuid)
      .eq('status', 'QUEUED')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('offline_conversion_queue')
      .select('created_at')
      .eq('site_id', siteUuid)
      .eq('status', 'RETRY')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('offline_conversion_queue')
      .select('updated_at')
      .eq('site_id', siteUuid)
      .eq('status', 'PROCESSING')
      .order('updated_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    countWonMissingPipelineForSite(adminClient, siteUuid),
    fetchSiteSsotFlags(adminClient, siteUuid),
  ]);

  const minutesSince = (iso: string | undefined | null): number | null => {
    if (!iso) return null;
    return (Date.now() - new Date(iso).getTime()) / 60000;
  };
  const oldestQueuedAgeMinutes = minutesSince((oldestQueuedRow as { created_at?: string } | null)?.created_at);
  const oldestRetryAgeMinutes = minutesSince((oldestRetryRow as { created_at?: string } | null)?.created_at);
  const oldestProcessingAgeMinutes = minutesSince(
    (oldestProcessingRow as { updated_at?: string } | null)?.updated_at
  );

  const { data: uploadSample } = await adminClient
    .from('offline_conversion_queue')
    .select('uploaded_at')
    .eq('site_id', siteUuid)
    .not('uploaded_at', 'is', null)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: completedSample } = await adminClient
    .from('offline_conversion_queue')
    .select('updated_at')
    .eq('site_id', siteUuid)
    .eq('status', 'COMPLETED')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const queueBacklogActive = totals.QUEUED + totals.RETRY + totals.PROCESSING;
  const queueInFlightUploaded = totals.UPLOADED;
  const queueExportActive = queueBacklogActive + queueInFlightUploaded;
  const unifiedExportBacklog = queueBacklogActive;

  const lastUpdatedAt = (lastRow as { updated_at?: string } | null)?.updated_at ?? undefined;
  const blockedQueueOldestAt = blockedMetrics.oldestBlockedAtIso;
  const lastQueueUploadAt =
    (uploadSample as { uploaded_at?: string } | null)?.uploaded_at ?? null;
  const lastQueueCompletedAt =
    (completedSample as { updated_at?: string } | null)?.updated_at ?? null;
  const outboxPending = typeof outboxPendingCount === 'number' ? outboxPendingCount : 0;
  const outboxProcessingStale = typeof outboxStaleCount === 'number' ? outboxStaleCount : 0;
  const outboxFailedRecent = typeof outboxFailedRecentCount === 'number' ? outboxFailedRecentCount : 0;
  const truthRepairBacklog = typeof truthRepairBacklogCount === 'number' ? truthRepairBacklogCount : 0;
  const queueActive = totals.QUEUED + totals.RETRY + totals.PROCESSING + totals.UPLOADED;
  const outboxActive = outboxPending + outboxProcessingStale + outboxFailedRecent;
  const parityDenominator = Math.max(queueActive, outboxActive, 1);
  const outboxQueueParityRatio = Number((Math.min(queueActive, outboxActive) / parityDenominator).toFixed(4));

  const totalQueue = Array.isArray(rows) ? rows.length : 0;

  const queueHealth = evaluateQueueHealth({
    evaluationMode: 'operational',
    targetDbEvidenceAvailable: true,
    siteId: siteUuid,
    stuckProcessingCount: typeof stuckProcessing === 'number' ? stuckProcessing : 0,
    wonMissingPipelineCount,
    oldestQueuedAgeMinutes,
    oldestRetryAgeMinutes,
    oldestProcessingAgeMinutes,
    totalQueue,
    retryCount: totals.RETRY,
    failedCount: totals.FAILED,
    deadLetterQuarantineCount: totals.DEAD_LETTER_QUARANTINE,
    timeSsotRed: ssotFlags.timeSsotRed,
    valueIntegrityRed: ssotFlags.valueIntegrityRed,
    identityIntegrityRed: ssotFlags.identityIntegrityRed,
  });

  const body: OciQueueStats = {
    siteId: siteUuid,
    ociSyncMethod,
    unifiedExportBacklog,
    queueBacklogActive,
    queueInFlightUploaded,
    queueExportActive,
    totals,
    ...(stuckProcessing !== undefined && { stuckProcessing }),
    ...(lastUpdatedAt && { lastUpdatedAt }),
    outboxPending,
    outboxProcessingStale,
    outboxFailedRecent,
    truthRepairBacklog,
    outboxQueueParityRatio,
    blockedQueueOldestAt,
    oldestBlockedAgeSeconds: blockedMetrics.oldestBlockedAgeSeconds,
    blockReasonBreakdown: blockedMetrics.blockReasonBreakdown,
    promotionReadyInSample: blockedMetrics.promotionReadyInSample,
    blockedPromotionScanCapped: blockedMetrics.promotionScanCapped,
    lastQueueUploadAt,
    lastQueueCompletedAt,
    queueHealthPolicyVersion: queueHealth.policy_version,
    queue_health_status: queueHealth.queue_health_status,
    queue_health_score: queueHealth.queue_health_score,
    blocking_reasons: queueHealth.blocking_reasons,
    queued_count: totals.QUEUED,
    retry_count: totals.RETRY,
    processing_count: totals.PROCESSING,
    failed_count: totals.FAILED,
    dlq_count: totals.DEAD_LETTER_QUARANTINE,
    stuck_processing_count: typeof stuckProcessing === 'number' ? stuckProcessing : undefined,
    oldest_queued_age_minutes: oldestQueuedAgeMinutes,
    oldest_retry_age_minutes: oldestRetryAgeMinutes,
    oldest_processing_age_minutes: oldestProcessingAgeMinutes,
    retry_rate: queueHealth.retry_rate,
    failed_rate: queueHealth.failed_rate,
    won_missing_pipeline_count: wonMissingPipelineCount,
    queue_health_evaluation_mode: 'operational',
  };
  return NextResponse.json(body);
}
