/**
 * Mizan Mantik: Canonical Stage Router
 * Directs pure mathematical payloads into the funnel ledger.
 */

import type { PipelineStage, SignalPayload, EvaluateResult } from '../types';
import { insertMarketingSignal } from '../insert-marketing-signal';
import { ensureMarketingSignalQueueParity } from '@/lib/oci/marketing-signal-queue-parity';

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
  const queueParityResult = await ensureMarketingSignalQueueParity({
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
      signalId: result.signalId,
      conversionValue: result.conversionValue,
      dropped: true,
      causalDna: {
        queue_result: 'error',
        queue_error: 'NOT_EXPORT_ELIGIBLE',
        signal_write_result: result.success ? 'ok' : 'failed',
        queue_parity_result: queueParityResult.reasonCode,
        parity_key: queueParityResult.parityKey,
      },
    };
  }

  if (!queueParityResult.queueEnqueued && queueParityResult.reasonCode === 'PARITY_CONSENT_MISSING') {
    return {
      routed: false,
      signalId: result.signalId,
      conversionValue: result.conversionValue,
      dropped: true,
      causalDna: {
        queue_result: 'skipped',
        queue_reason: 'CONSENT_MISSING',
        signal_write_result: result.success ? 'ok' : 'failed',
        queue_parity_result: queueParityResult.reasonCode,
        parity_key: queueParityResult.parityKey,
      },
    };
  }

  return {
    routed:
      result.success ||
      queueParityResult.queueEnqueued ||
      queueParityResult.reasonCode === 'PARITY_QUEUE_DUPLICATE',
    signalId: result.signalId,
    conversionValue: result.conversionValue,
    dropped: !result.success && !queueParityResult.queueEnqueued,
    causalDna: {
      ...(result.causalDna ?? {}),
      signal_write_result: result.success ? 'ok' : 'failed',
      queue_parity_result: queueParityResult.reasonCode,
      parity_key: queueParityResult.parityKey,
      queue_enqueued: queueParityResult.queueEnqueued,
      queue_id: queueParityResult.queueId ?? null,
    },
  };
}
