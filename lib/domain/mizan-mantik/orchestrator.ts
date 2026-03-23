/**
 * MizanMantik — Domain Orchestrator (Phase 20: Gear-Strategy delegation)
 *
 * Gatekeeper and Ledger Router. Delegates to V1–V5 gear implementations.
 * V1: Redis (value=0). V2-V4: marketing_signals (decay). V5: Iron Seal (no decay).
 */

import { createCausalDna, appendBranch, toJsonb } from './causal-dna';
import { getSiteValueConfig } from './value-config';
import { getEntropyScore } from './entropy-service';
import type { OpsGear, SignalPayload, EvaluateResult } from './types';
import { LEGACY_TO_OPS_GEAR, type LegacySignalType } from './types';
import { getGear } from './gears/GearRegistry';

/**
 * Evaluate and route signal. Delegates to gear implementation.
 */
export async function evaluateAndRouteSignal(
  gear: OpsGear,
  payload: SignalPayload
): Promise<EvaluateResult> {
  const { siteId, fingerprint } = payload;
  const { score: entropyScore, uncertaintyBit } = await getEntropyScore(fingerprint ?? null);
  let dna = createCausalDna(gear);

  const config = gear === 'V1_PAGEVIEW' ? null : await getSiteValueConfig(siteId);

  // Phase 19: Forensic SST & Geo-Fence (V2–V5 only)
  if (config) {
    const clientIp = payload.clientIp;
    if (!clientIp) {
      dna = appendBranch(dna, 'SST_HEADER_FAIL', ['audit'], {}, { reason: 'missing_xff' });
    } else {
      // BUG-3 FIX: Use timezone-based detection instead of fragile site-name string matching.
      // 'Europe/Istanbul' is set per-site via oci_config.timezone (default for TR sites).
      const isTurkishSite = config.timezone === 'Europe/Istanbul';
      if (isTurkishSite) {
        dna = appendBranch(dna, 'GEO_FENCE_TR_CHECK', ['audit'], { clientIp }, { isTurkishSite });
      }
    }
  }

  const gearImpl = getGear(gear);
  const context = {
    siteId,
    config,
    entropyScore,
    uncertaintyBit,
  };

  const preResult = await gearImpl.preValidate(payload, dna, context);
  if (!preResult.pass) {
    return {
      routed: false,
      conversionValue: 0,
      dropped: preResult.dropped ?? false,
      causalDna: toJsonb(preResult.dna),
    };
  }

  return gearImpl.route(payload, preResult.dna, context);
}

/** Resolve OpsGear from legacy signal type */
/** @deprecated Unused; legacy signal mapping. Kept for API. */
export function resolveGearFromLegacy(legacy: LegacySignalType): OpsGear {
  return LEGACY_TO_OPS_GEAR[legacy];
}
