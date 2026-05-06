/**
 * Mizan Mantik: Canonical Stage Router
 * Directs pure mathematical payloads into the funnel ledger.
 */

import type { PipelineStage, SignalPayload, EvaluateResult } from '../types';
import { insertMarketingSignal } from '../insert-marketing-signal';

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
  // contacted / offered / junk → insertMarketingSignal → marketing_signals (OCI export).
  if (stage === 'won') {
    return { routed: false, conversionValue: 0, dropped: true, causalDna: {} };
  }

  // contacted, offered, junk → marketing_signals
  const result = await insertMarketingSignal({
    siteId,
    callId,
    traceId: traceId ?? null,
    stage,
    payload,
  });

  return {
    routed: result.success,
    signalId: result.signalId,
    conversionValue: result.conversionValue,
    dropped: !result.success,
    causalDna: result.causalDna,
  };
}
