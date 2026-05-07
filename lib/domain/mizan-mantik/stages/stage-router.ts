/**
 * Mizan Mantik: Canonical Stage Router
 * Directs pure mathematical payloads into the funnel ledger.
 */

import type { PipelineStage, SignalPayload, EvaluateResult } from '../types';
import { insertMarketingSignal } from '../insert-marketing-signal';
import { enqueueOciConversionRow } from '@/lib/oci/enqueue-oci-conversion-row';

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
  // contacted / offered / junk → insertMarketingSignal → marketing_signals (audit); Google upload = journal only.
  if (stage === 'won') {
    return { routed: false, conversionValue: 0, dropped: true, causalDna: {} };
  }

  // contacted, offered, junk -> marketing_signals (legacy audit lane)
  // and journal row (offline_conversion_queue) for Google upload authority.
  const result = await insertMarketingSignal({
    siteId,
    callId,
    traceId: traceId ?? null,
    stage,
    payload,
  });

  const leadScore = Number.isFinite(payload.systemScore as number) ? Number(payload.systemScore) : 0;
  const queueResult = await enqueueOciConversionRow({
    siteId,
    callId,
    stage,
    signalDate: payload.signalDate,
    intentCreatedAt: null,
    leadScore,
    currency: 'TRY',
    sourceOutboxEventId: null,
    gclid: payload.gclid ?? null,
    wbraid: payload.wbraid ?? null,
    gbraid: payload.gbraid ?? null,
  });

  if (!queueResult.enqueued && queueResult.reason === 'error') {
    return {
      routed: false,
      signalId: result.signalId,
      conversionValue: result.conversionValue,
      dropped: true,
      causalDna: {
        queue_result: 'error',
        queue_error: queueResult.error ?? 'NOT_EXPORT_ELIGIBLE',
      },
    };
  }

  if (!queueResult.enqueued && queueResult.reason === 'CONSENT_MISSING') {
    return {
      routed: false,
      signalId: result.signalId,
      conversionValue: result.conversionValue,
      dropped: true,
      causalDna: {
        queue_result: 'skipped',
        queue_reason: 'CONSENT_MISSING',
      },
    };
  }

  return {
    routed: result.success || queueResult.enqueued || queueResult.reason === 'duplicate',
    signalId: result.signalId,
    conversionValue: result.conversionValue,
    dropped: !result.success && !queueResult.enqueued,
    causalDna: {
      ...(result.causalDna ?? {}),
      queue_enqueued: queueResult.enqueued,
      queue_id: queueResult.queueId ?? null,
      queue_reason: queueResult.reason ?? null,
    },
  };
}
