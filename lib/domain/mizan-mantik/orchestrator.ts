/**
 * MizanMantik — Domain Orchestrator
 *
 * Gatekeeper and Ledger Router. Routes canonical PipelineStages.
 */

import { getEntropyScore } from './entropy-service';
import type { PipelineStage, SignalPayload, EvaluateResult } from './types';
import { routeStage } from './stages/stage-router';

/**
 * Evaluate and route signal directly through the canonical stage router.
 */
export async function evaluateAndRouteSignal(
  stage: PipelineStage,
  payload: SignalPayload
): Promise<EvaluateResult> {
  const { siteId, fingerprint } = payload;

  const context = {
    siteId,
    entropyScore: (await getEntropyScore(fingerprint ?? null)).score,
    uncertaintyBit: (await getEntropyScore(fingerprint ?? null)).uncertaintyBit,
  };

  return routeStage(stage, payload, context);
}
