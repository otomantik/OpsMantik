/**
 * OCI outbox notifier — real-time trigger for the outbox processor.
 *
 * Call this after a seal/stage RPC has written a PENDING row to
 * `outbox_events`. It publishes a QStash message pointing at the signed
 * worker at /api/workers/oci/process-outbox, so the processor runs within
 * seconds instead of waiting for the cron poll.
 *
 * Failures are logged and swallowed: the cron at
 * /api/cron/oci/process-outbox-events is the safety net that guarantees
 * eventual processing even if every notify publish is dropped.
 *
 * Dedup strategy:
 *   - We tag each publish with a deduplicationId scoped to `callId` + a
 *     10-second bucket. QStash ignores duplicate IDs received within its
 *     ~10-minute dedup window, which is exactly what we want: a call that
 *     gets stage-transitioned multiple times in quick succession should
 *     still only fan out a handful of worker triggers, not one per update.
 */

import { publishToQStash, resolveAppBaseUrlForIngest } from '@/lib/ingest/publish';
import { logWarn } from '@/lib/logging/logger';

/** Exposed so tests and ops tooling can import the canonical URL. */
export function resolveOutboxWorkerUrl(): string {
  const base = resolveAppBaseUrlForIngest();
  return `${base}/api/workers/oci/process-outbox`;
}

/** Bucket size for burst coalescing. 10 s keeps latency low while still merging rapid retries. */
export const NOTIFY_BUCKET_MS = 10_000;

export interface NotifyOutboxParams {
  callId: string;
  siteId: string;
  /** 'seal' | 'stage' | 'cron' | etc. — included in the payload for observability only. */
  source: string;
  /** Override clock for tests. */
  now?: Date;
}

export interface OutboxNotifyPayload {
  url: string;
  body: {
    kind: 'oci_outbox_trigger';
    call_id: string;
    site_id: string;
    source: string;
    emitted_at: string;
  };
  deduplicationId: string;
}

/**
 * Pure builder: compose the URL, body, and deduplicationId that we would send
 * to QStash. Exposed so unit tests can verify the dedup bucketing without
 * mocking the QStash client.
 */
export function buildOutboxNotifyPayload(params: NotifyOutboxParams): OutboxNotifyPayload {
  const { callId, siteId, source } = params;
  const now = params.now ?? new Date();
  const bucket = Math.floor(now.getTime() / NOTIFY_BUCKET_MS);
  return {
    url: resolveOutboxWorkerUrl(),
    body: {
      kind: 'oci_outbox_trigger',
      call_id: callId,
      site_id: siteId,
      source,
      emitted_at: now.toISOString(),
    },
    deduplicationId: `oci-outbox:${callId}:${bucket}`,
  };
}

/**
 * Publish a best-effort QStash trigger for the outbox processor.
 * Never throws — callers are expected to have already written the
 * authoritative row to `outbox_events` and the cron is the safety net.
 */
export async function notifyOutboxPending(params: NotifyOutboxParams): Promise<void> {
  const payload = buildOutboxNotifyPayload(params);

  if (!/^https?:\/\//i.test(payload.url)) {
    // No absolute base URL configured (dev without NEXT_PUBLIC_APP_URL / VERCEL_URL).
    // Silently skip — the cron safety net will still process the row.
    logWarn('OCI_NOTIFY_OUTBOX_SKIPPED_NO_BASE_URL', {
      call_id: params.callId,
      site_id: params.siteId,
      source: params.source,
    });
    return;
  }

  try {
    await publishToQStash({
      url: payload.url,
      body: payload.body,
      deduplicationId: payload.deduplicationId,
      retries: 3,
    });
  } catch (err) {
    logWarn('OCI_NOTIFY_OUTBOX_FAILED', {
      call_id: params.callId,
      site_id: params.siteId,
      source: params.source,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
