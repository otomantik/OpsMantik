/**
 * PR4-B — Thin runner: attribution vs traffic classifier paid-surface parity (metrics + mismatch logs only).
 */

import { determineTrafficSource } from '@/lib/analytics/source-classifier';
import type { AttributionInput, AttributionResult } from '@/lib/attribution';
import { ENGINE_CONTRACT_VERSION } from '@/lib/domain/deterministic-engine/contract';
import { buildClassifierParamsForParity } from '@/lib/domain/deterministic-engine/parity-params';
import {
  paidSurfaceFromAttributionResult,
  paidSurfaceFromTrafficClassificationV1,
} from '@/lib/domain/deterministic-engine/paid-surface';
import { comparePaidSurfaceBuckets } from '@/lib/domain/deterministic-engine/parity-compare';
import { logDebug } from '@/lib/logging/logger';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

export type AttributionPaidSurfaceParityInput = {
  siteId: string;
  url: string;
  referrer: string | null;
  sanitizedGclid: string | null;
  utm: AttributionInput['utm'] | null;
  attribution: AttributionResult;
};

/**
 * When TRUTH_ENGINE_CONSOLIDATED_ENABLED is false: no-op.
 * When true: increments parity counters; logDebug only on mismatch.
 */
export function runAttributionPaidSurfaceParity(input: AttributionPaidSurfaceParityInput): void {
  if (!getRefactorFlags().truth_engine_consolidated_enabled) {
    return;
  }

  const params = buildClassifierParamsForParity({
    sanitizedGclid: input.sanitizedGclid,
    utm: input.utm,
  });
  const tc = determineTrafficSource(input.url, input.referrer ?? '', params);
  const primary = paidSurfaceFromAttributionResult(input.attribution);
  const shadow = paidSurfaceFromTrafficClassificationV1(tc);
  const outcome = comparePaidSurfaceBuckets(primary, shadow);

  incrementRefactorMetric('truth_engine_consolidated_attribution_parity_check_total');
  if (outcome === 'match') {
    incrementRefactorMetric('truth_engine_consolidated_attribution_parity_match_total');
    return;
  }

  incrementRefactorMetric('truth_engine_consolidated_attribution_parity_mismatch_total');
  logDebug('ENGINE_CONSOLIDATED_ATTRIBUTION_PARITY_MISMATCH', {
    contract: ENGINE_CONTRACT_VERSION,
    site_id: input.siteId,
    primary_bucket: primary,
    shadow_bucket: shadow,
    traffic_medium: tc.traffic_medium,
    traffic_source: tc.traffic_source,
    attribution_source: input.attribution.source,
    attribution_is_paid: input.attribution.isPaid,
  });
}
