import type { PipelineStage, SignalPayload, EvaluateResult } from '@/lib/oci/signal-types';
import { insertMarketingSignal } from '@/lib/oci/insert-marketing-signal';

export interface RouterContext {
  siteId: string;
  entropyScore: number;
  uncertaintyBit: boolean | null;
}

export async function routeStage(
  stage: PipelineStage,
  payload: SignalPayload,
  context: RouterContext
): Promise<EvaluateResult> {
  void context;
  const { siteId, callId, traceId } = payload;
  if (!callId) {
    return { routed: false, conversionValue: 0, dropped: true, causalDna: {} };
  }

  if (stage === 'won') {
    return { routed: false, conversionValue: 0, dropped: true, causalDna: {} };
  }

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
