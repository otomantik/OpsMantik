/**
 * Funnel Kernel Value Formula — SSOT for export value computation.
 * See: docs/architecture/FUNNEL_CONTRACT.md, Faz 6
 *
 * V5 = exact value_cents (no stage weight, no decay).
 * V2–V4 = base × stage_weight × quality_weight × confidence_weight × decay.
 */

import {
  getStageWeight,
  getQualityWeight,
  getConfidenceWeight,
  type ProjectionStage,
  type ProjectionForValue,
} from './funnel-policy';

/** Decay by stage and days (0–365). V2 soft, V3 standard, V4 aggressive. */
function getDecayMultiplier(stage: ProjectionStage, days: number): number {
  if (stage === 'V5') return 1;
  if (days <= 0) return 1;
  switch (stage) {
    case 'V2':
      if (days <= 3) return 0.5;
      if (days <= 10) return 0.3;
      return 0.15;
    case 'V3':
      if (days <= 3) return 0.5;
      if (days <= 10) return 0.25;
      return 0.1;
    case 'V4':
      if (days <= 3) return 0.5;
      if (days <= 10) return 0.2;
      return 0.05;
    default:
      return 1;
  }
}

/**
 * V5 sealed value — exact value_cents, no multiplier.
 */
export function computeSealedValue(exactValueCents: number): number {
  if (!Number.isFinite(exactValueCents) || exactValueCents < 0) return 0.01;
  return Math.round(exactValueCents) / 100;
}

/**
 * V2–V4 estimated value with decay.
 * estimated = baseValue × stage_weight × quality_weight × confidence_weight × decay
 */
export function computeEstimatedValue(
  stage: 'V2' | 'V3' | 'V4',
  baseValue: number,
  qualityScore: number | null | undefined,
  confidence: number | null | undefined,
  days: number,
  _policyVersion?: string
): number {
  const sw = getStageWeight(stage);
  const qw = getQualityWeight(qualityScore);
  const cw = getConfidenceWeight(confidence);
  const decay = getDecayMultiplier(stage, Math.min(365, Math.max(0, days)));
  const estimated = baseValue * sw * qw * cw * decay;
  return Math.max(0.01, Math.round(estimated * 100) / 100);
}

/**
 * Compute export value: V5 uses exact value_cents; V2–V4 use estimated (no decay in export context).
 * Re-export from funnel-policy for SSOT.
 */
export { computeExportValue } from './funnel-policy';
export type { ProjectionForValue, ProjectionStage } from './funnel-policy';
