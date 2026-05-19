/**
 * Mizan Mantik: Canonical Stage Router
 * Directs pure mathematical payloads into the funnel ledger.
 */

import type { PipelineStage, SignalPayload, EvaluateResult } from '../types';
import { ensureOciQueueEnqueue } from '@/lib/oci/ensure-oci-queue-enqueue';

export interface RouterContext {
  siteId: string;
}

export async function routeStage(
  stage: PipelineStage,
  payload: SignalPayload,
  _context: RouterContext
): Promise<EvaluateResult> {
  const { siteId, callId, traceId } = payload;
  // Pre-validation block
  if (!callId) {
    return { routed: false, conversionValue: 0, dropped: true, causalDna: {} };
  }

  // 'won' is exclusively owned by the seal path (enqueueSealConversion → offline_conversion_queue).
  // contacted / offered / junk → offline_conversion_queue journal only (queue SSOT).
  if (stage === 'won') {
    return { routed: false, conversionValue: 0, dropped: true, causalDna: {} };
  }

  const leadScore = Number.isFinite(payload.systemScore as number) ? Number(payload.systemScore) : 0;
  const queueParityResult = await ensureOciQueueEnqueue({
    siteId,
    callId,
    stage,
    occurredAt: payload.signalDate,
    leadScore,
    currency: 'TRY',
    gclid: payload.gclid ?? null,
    wbraid: payload.wbraid ?? null,
    gbraid: payload.gbraid ?? null,
    consentState: 'unknown',
    source: 'mizan_stage_router',
    traceId: traceId ?? null,
  });

  if (!queueParityResult.queueEnqueued && queueParityResult.reasonCode === 'PARITY_QUEUE_ERROR') {
    return {
      routed: false,
      conversionValue: 0,
      dropped: true,
      causalDna: {
        queue_result: 'error',
        queue_error: 'NOT_EXPORT_ELIGIBLE',
        queue_parity_result: queueParityResult.reasonCode,
        parity_key: queueParityResult.parityKey,
      },
    };
  }

  if (!queueParityResult.queueEnqueued && queueParityResult.reasonCode === 'PARITY_CONSENT_MISSING') {
    return {
      routed: false,
      conversionValue: 0,
      dropped: true,
      causalDna: {
        queue_result: 'skipped',
        queue_reason: 'CONSENT_MISSING',
        queue_parity_result: queueParityResult.reasonCode,
        parity_key: queueParityResult.parityKey,
      },
    };
  }

  return {
    routed: queueParityResult.queueEnqueued || queueParityResult.reasonCode === 'PARITY_QUEUE_DUPLICATE',
    conversionValue: 0,
    dropped: !queueParityResult.queueEnqueued,
    causalDna: {
      queue_parity_result: queueParityResult.reasonCode,
      parity_key: queueParityResult.parityKey,
      queue_enqueued: queueParityResult.queueEnqueued,
      queue_id: queueParityResult.queueId ?? null,
    },
  };
}
