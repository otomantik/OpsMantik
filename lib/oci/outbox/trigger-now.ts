import { runProcessOutbox } from '@/lib/oci/outbox/process-outbox';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { logWarn } from '@/lib/logging/logger';

let outboxDrainInFlight = false;

/**
 * Best-effort local trigger so panel actions do not rely solely on cron/QStash.
 * This keeps queue latency low even when external notify channels are degraded.
 */
export async function triggerOutboxNowBestEffort(params: {
  callId: string;
  siteId: string;
  source: string;
}): Promise<void> {
  if (outboxDrainInFlight) return;
  outboxDrainInFlight = true;
  try {
    const result = await runProcessOutbox();
    if (!result.ok) {
      incrementRefactorMetric('outbox_inline_drain_failed_total');
      logWarn('OCI_OUTBOX_INLINE_DRAIN_FAILED', {
        call_id: params.callId,
        site_id: params.siteId,
        source: params.source,
        error: result.error,
      });
    }
  } catch (error) {
    incrementRefactorMetric('outbox_inline_drain_failed_total');
    logWarn('OCI_OUTBOX_INLINE_DRAIN_EXCEPTION', {
      call_id: params.callId,
      site_id: params.siteId,
      source: params.source,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    outboxDrainInFlight = false;
  }
}
