/**
 * MizanMantik — Domain Orchestrator
 *
 * Gatekeeper and Ledger Router. Routes canonical PipelineStages.
 */

import type { PipelineStage, SignalPayload, EvaluateResult } from './types';
import { routeStage } from './stages/stage-router';

/**
 * Evaluate and route signal directly through the canonical stage router.
 */
export async function evaluateAndRouteSignal(
  stage: PipelineStage,
  payload: SignalPayload
): Promise<EvaluateResult> {
  const { siteId } = payload;

  const context = {
    siteId,
    // Legacy entropy service was removed; keep deterministic neutral context.
    entropyScore: 0,
    uncertaintyBit: payload.uncertaintyBit ?? null,
  };

  return routeStage(stage, payload, context);
}
