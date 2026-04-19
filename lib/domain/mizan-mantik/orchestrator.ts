/**
 * MizanMantik — Domain Orchestrator
 *
 * Gatekeeper and Ledger Router. Routes canonical PipelineStages.
 */

import { createCausalDna, appendBranch, toJsonb } from './causal-dna';
import { getSiteValueConfig } from './value-config';
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
  const { score: entropyScore, uncertaintyBit } = await getEntropyScore(fingerprint ?? null);
  let dna = createCausalDna(stage);

  // Junk stages generally bypass deep economics fetching
  const config = stage === 'junk' ? null : await getSiteValueConfig(siteId);

  // Forensic SST audit — neutral (no country-specific branches).
  // Geo-fence logic should come from an explicit site.country_iso policy, not
  // a timezone string that accidentally binds behaviour to a single locale.
  if (config) {
    const clientIp = payload.clientIp;
    if (!clientIp) {
      dna = appendBranch(dna, 'SST_HEADER_FAIL', ['audit'], {}, { reason: 'missing_xff' });
    }
  }

  const context = {
    siteId,
    entropyScore,
    uncertaintyBit,
  };

  return routeStage(stage, payload, context, dna);
}
