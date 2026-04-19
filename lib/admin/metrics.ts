/**
 * Admin metrics SSOT — snapshot of the OCI pipeline health surfaces that
 * ops cares about. Returns small, JSON-serializable counts; no PII.
 *
 * Consumed by `/api/admin/metrics` (dashboard + external uptime probes).
 * Every field is safe to log in Sentry tags/context.
 *
 * Shape is stable: future fields are additive so external probes don't break.
 */

import { adminClient } from '@/lib/supabase/admin';

export interface AdminMetricsSnapshot {
  ok: true;
  /** ISO-8601 UTC timestamp of the snapshot. */
  timestamp: string;
  outbox: {
    pending: number;
    processing: number;
    failed: number;
    processed_last_24h: number;
  };
  queue: {
    queued: number;
    retry: number;
    processing: number;
    uploaded: number;
    completed_last_24h: number;
    failed: number;
    dead_letter_depth: number;
  };
  signals: {
    pending: number;
    processed_last_24h: number;
    failed: number;
  };
  dlq: {
    sync_dlq_depth: number;
  };
  /** Ratio completed / (completed + failed) over the last 24h. Null when denominator is 0. */
  success_rate_last_24h: {
    queue: number | null;
    outbox: number | null;
  };
}

function last24hIso(now: Date): string {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

function ratio(completed: number, failed: number): number | null {
  const denom = completed + failed;
  if (denom === 0) return null;
  return Number((completed / denom).toFixed(4));
}

/** Count rows matching `status = value`. Fail-soft: returns 0 on any error. */
async function countByStatus(table: string, status: string): Promise<number> {
  try {
    const { count, error } = await adminClient
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('status', status);
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

/** Count rows where `status = value AND timestampColumn >= since`. */
async function countByStatusSince(
  table: string,
  status: string,
  timestampColumn: string,
  since: string
): Promise<number> {
  try {
    const { count, error } = await adminClient
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('status', status)
      .gte(timestampColumn, since);
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

/** Count rows where `status IN (...values) AND timestampColumn >= since`. */
async function countByStatusInSince(
  table: string,
  statuses: string[],
  timestampColumn: string,
  since: string
): Promise<number> {
  try {
    const { count, error } = await adminClient
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in('status', statuses)
      .gte(timestampColumn, since);
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

/** Count rows matching `dispatch_status = value`. */
async function countByDispatchStatus(status: string): Promise<number> {
  try {
    const { count, error } = await adminClient
      .from('marketing_signals')
      .select('*', { count: 'exact', head: true })
      .eq('dispatch_status', status);
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

/** Count rows matching `dispatch_status = value AND timestampColumn >= since`. */
async function countByDispatchStatusSince(
  status: string,
  timestampColumn: string,
  since: string
): Promise<number> {
  try {
    const { count, error } = await adminClient
      .from('marketing_signals')
      .select('*', { count: 'exact', head: true })
      .eq('dispatch_status', status)
      .gte(timestampColumn, since);
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

/** Total row count (no predicates). Used for sync_dlq depth. */
async function countAll(table: string): Promise<number> {
  try {
    const { count, error } = await adminClient
      .from(table)
      .select('*', { count: 'exact', head: true });
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Build a single admin metrics snapshot. Fail-soft: any per-table failure
 * contributes 0 rather than aborting the whole response so ops always sees a
 * baseline heartbeat.
 */
export async function buildAdminMetricsSnapshot(
  now: Date = new Date()
): Promise<AdminMetricsSnapshot> {
  const windowStart = last24hIso(now);

  const [
    outboxPending,
    outboxProcessing,
    outboxFailed,
    outboxProcessed24h,
    queueQueued,
    queueRetry,
    queueProcessing,
    queueUploaded,
    queueCompleted24h,
    queueFailed,
    queueDlq,
    signalsPending,
    signalsProcessed24h,
    signalsFailed,
    syncDlq,
  ] = await Promise.all([
    // outbox_events
    countByStatus('outbox_events', 'PENDING'),
    countByStatus('outbox_events', 'PROCESSING'),
    countByStatus('outbox_events', 'FAILED'),
    countByStatusSince('outbox_events', 'PROCESSED', 'processed_at', windowStart),

    // offline_conversion_queue
    countByStatus('offline_conversion_queue', 'QUEUED'),
    countByStatus('offline_conversion_queue', 'RETRY'),
    countByStatus('offline_conversion_queue', 'PROCESSING'),
    countByStatus('offline_conversion_queue', 'UPLOADED'),
    countByStatusInSince(
      'offline_conversion_queue',
      ['COMPLETED', 'COMPLETED_UNVERIFIED'],
      'updated_at',
      windowStart
    ),
    countByStatus('offline_conversion_queue', 'FAILED'),
    countByStatus('offline_conversion_queue', 'DEAD_LETTER_QUARANTINE'),

    // marketing_signals — optional dispatch_status column (exists in most deploys).
    countByDispatchStatus('PENDING'),
    countByDispatchStatusSince('PROCESSED', 'updated_at', windowStart),
    countByDispatchStatus('FAILED'),

    // sync_dlq
    countAll('sync_dlq'),
  ]);

  return {
    ok: true,
    timestamp: now.toISOString(),
    outbox: {
      pending: outboxPending,
      processing: outboxProcessing,
      failed: outboxFailed,
      processed_last_24h: outboxProcessed24h,
    },
    queue: {
      queued: queueQueued,
      retry: queueRetry,
      processing: queueProcessing,
      uploaded: queueUploaded,
      completed_last_24h: queueCompleted24h,
      failed: queueFailed,
      dead_letter_depth: queueDlq,
    },
    signals: {
      pending: signalsPending,
      processed_last_24h: signalsProcessed24h,
      failed: signalsFailed,
    },
    dlq: {
      sync_dlq_depth: syncDlq,
    },
    success_rate_last_24h: {
      queue: ratio(queueCompleted24h, queueFailed),
      outbox: ratio(outboxProcessed24h, outboxFailed),
    },
  };
}

/**
 * Flatten the snapshot into a tag map safe for Sentry `setTag` (string values
 * only, ≤ 200 chars each, ≤ 50 keys). Use for the metrics route's own
 * telemetry so Sentry can alert on `metrics_outbox_pending > X`.
 */
export function snapshotToSentryTags(snapshot: AdminMetricsSnapshot): Record<string, string> {
  const tags: Record<string, string> = {
    route: '/api/admin/metrics',
    'metrics.outbox.pending': String(snapshot.outbox.pending),
    'metrics.outbox.processing': String(snapshot.outbox.processing),
    'metrics.outbox.failed': String(snapshot.outbox.failed),
    'metrics.queue.queued': String(snapshot.queue.queued),
    'metrics.queue.retry': String(snapshot.queue.retry),
    'metrics.queue.failed': String(snapshot.queue.failed),
    'metrics.queue.dead_letter_depth': String(snapshot.queue.dead_letter_depth),
    'metrics.signals.pending': String(snapshot.signals.pending),
    'metrics.signals.failed': String(snapshot.signals.failed),
    'metrics.dlq.sync_dlq_depth': String(snapshot.dlq.sync_dlq_depth),
  };
  if (snapshot.success_rate_last_24h.queue !== null) {
    tags['metrics.success_rate_24h.queue'] = String(snapshot.success_rate_last_24h.queue);
  }
  if (snapshot.success_rate_last_24h.outbox !== null) {
    tags['metrics.success_rate_24h.outbox'] = String(snapshot.success_rate_last_24h.outbox);
  }
  return tags;
}
