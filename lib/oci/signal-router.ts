import type { PipelineStage, SignalPayload, EvaluateResult } from '@/lib/oci/signal-types';
import { routeStage } from '@/lib/oci/stages/stage-router';

export async function evaluateAndRouteSignal(
  stage: PipelineStage,
  payload: SignalPayload
): Promise<EvaluateResult> {
  const { siteId } = payload;
  const context = {
    siteId,
    entropyScore: 0,
    uncertaintyBit: payload.uncertaintyBit ?? null,
  };
  return routeStage(stage, payload, context);
}
