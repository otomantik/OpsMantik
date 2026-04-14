/**
 * Funnel Kernel Policy — lightweight stage policy metadata.
 * Monetary math now lives exclusively in mizan-mantik/value-calculator.
 */

import { normalizeWeight } from '@/lib/domain/mizan-mantik/value-config';

export type ProjectionStage = 'V2' | 'V3' | 'V4' | 'V5';

export interface ProjectionForValue {
  highest_stage: ProjectionStage;
  value_cents?: number | null;
  currency?: string | null;
  quality_score?: number | null;
  confidence?: number | null;
}

const DEFAULT_STAGE_WEIGHTS: Record<ProjectionStage, number> = {
  V2: 2,
  V3: 20,
  V4: 30,
  V5: 100,
};

/**
 * Normalized stage ratio for display/analytics helpers.
 * Accepts 0..100 or 0..1 inputs and always returns 0..1.
 */
export function getStageWeight(
  stage: ProjectionStage,
  gearWeights?: { V2?: number; V3?: number; V4?: number } | null
): number {
  if (gearWeights) {
    if (stage === 'V2' && gearWeights.V2 != null) return normalizeWeight(gearWeights.V2, DEFAULT_STAGE_WEIGHTS.V2);
    if (stage === 'V3' && gearWeights.V3 != null) return normalizeWeight(gearWeights.V3, DEFAULT_STAGE_WEIGHTS.V3);
    if (stage === 'V4' && gearWeights.V4 != null) return normalizeWeight(gearWeights.V4, DEFAULT_STAGE_WEIGHTS.V4);
  }
  return normalizeWeight(DEFAULT_STAGE_WEIGHTS[stage], DEFAULT_STAGE_WEIGHTS.V2);
}
