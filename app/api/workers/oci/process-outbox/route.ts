/**
 * POST /api/workers/oci/process-outbox
 *
 * Real-time trigger path for the outbox processor. Seal/stage/status routes publish a
 * QStash message pointing here after `enqueuePanelStageOciOutbox` inserts an
 * `outbox_events` row (the RPC only mutates `calls`); this worker claims and processes the backlog
 * immediately instead of waiting for the 5-minute cron poll.
 *
 * Auth: requireQstashSignature (also accepts the internal worker auth path
 *       so ops scripts can call it directly with CRON_SECRET).
 *
 * The cron at /api/cron/oci/process-outbox-events still runs as a safety net
 * for any QStash publish that gets dropped or DLQ'd past its deadline.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireQstashSignature } from '@/lib/qstash/require-signature';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { runProcessOutbox } from '@/lib/oci/outbox/process-outbox';
import { logInfo } from '@/lib/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function processOutboxWorkerHandler(
  req: NextRequest,
  runner: typeof runProcessOutbox = runProcessOutbox
): Promise<NextResponse> {
  const requestId = req.headers.get('x-request-id') ?? undefined;
  const result = await runner();

  logInfo('OCI_PROCESS_OUTBOX_WORKER_DONE', {
    request_id: requestId,
    claimed: result.claimed,
    processed: result.processed,
    failed: result.failed,
    ok: result.ok,
  });

  const headers = getBuildInfoHeaders();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, code: 'PROCESS_OUTBOX_ERROR' },
      { status: 500, headers }
    );
  }
  return NextResponse.json(
    {
      ok: true,
      claimed: result.claimed,
      processed: result.processed,
      failed: result.failed,
      message: result.message,
      errors: result.errors,
    },
    { status: 200, headers }
  );
}

export const POST = requireQstashSignature(
  processOutboxWorkerHandler as (req: NextRequest) => Promise<Response>
);
