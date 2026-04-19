/**
 * GET /api/admin/metrics
 *
 * Admin-only JSON heartbeat of the OCI pipeline: dispatch PENDING depths,
 * success rate over the last 24h, and DLQ depth. Shape is pinned by
 * `AdminMetricsSnapshot` in `lib/admin/metrics.ts`.
 *
 * Auth: `requireAdmin` (same guard as /api/sync/dlq/*).
 *
 * Sentry: we tag the request with all flattened counts so alerts like
 *   `metrics.outbox.pending:>500 AND metrics.success_rate_24h.outbox:<0.95`
 * can be authored directly from the Sentry UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireAdmin } from '@/lib/auth/require-admin';
import { logError, logInfo } from '@/lib/logging/logger';
import {
  buildAdminMetricsSnapshot,
  snapshotToSentryTags,
} from '@/lib/admin/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? undefined;

  Sentry.setTag('route', '/api/admin/metrics');
  if (requestId) Sentry.setTag('request_id', requestId);

  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const snapshot = await buildAdminMetricsSnapshot();

    // Enrich Sentry with every flattened metric so dashboards and alerts can
    // be authored directly from tag names — no extra instrumentation needed.
    const tags = snapshotToSentryTags(snapshot);
    for (const [k, v] of Object.entries(tags)) {
      Sentry.setTag(k, v);
    }
    Sentry.setContext('admin_metrics', {
      outbox: snapshot.outbox,
      queue: snapshot.queue,
      signals: snapshot.signals,
      dlq: snapshot.dlq,
      success_rate_last_24h: snapshot.success_rate_last_24h,
    });

    logInfo('ADMIN_METRICS_OK', {
      request_id: requestId,
      outbox_pending: snapshot.outbox.pending,
      queue_queued: snapshot.queue.queued,
      queue_dead_letter_depth: snapshot.queue.dead_letter_depth,
      sync_dlq_depth: snapshot.dlq.sync_dlq_depth,
      success_rate_queue_24h: snapshot.success_rate_last_24h.queue,
      success_rate_outbox_24h: snapshot.success_rate_last_24h.outbox,
    });

    return NextResponse.json(snapshot, {
      status: 200,
      headers: getBuildInfoHeaders(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('ADMIN_METRICS_FAILED', { request_id: requestId, error: message });
    Sentry.captureException(err, {
      tags: { request_id: requestId, route: '/api/admin/metrics' },
    });
    return NextResponse.json(
      { ok: false, error: message, code: 'ADMIN_METRICS_ERROR' },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
