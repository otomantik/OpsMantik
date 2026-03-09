/**
 * Funnel Kernel Policy — Stage/quality/confidence weights, export value SSOT.
 * See: docs/architecture/FUNNEL_CONTRACT.md
 * Policy dışı ad-hoc value hesabı yasak. Tek SSOT: value-config + policy.
 */

export type ProjectionStage = 'V2' | 'V3' | 'V4' | 'V5';

export interface ProjectionForValue {
  highest_stage: ProjectionStage;
  value_cents?: number | null;
  currency?: string | null;
  quality_score?: number | null;
  confidence?: number | null;
}

/** Stage weights: V2 2%, V3 10%, V4 30%, V5 = sealed (exact value, no multiplier) */
const STAGE_WEIGHTS: Record<ProjectionStage, number> = {
  V2: 0.02,
  V3: 0.1,
  V4: 0.3,
  V5: 1.0, // V5 uses exact value; weight only for fallback/estimated path
};

/** Quality score 1..5 → weight 0.2..1.0 linear */
export function getQualityWeight(score: number | null | undefined): number {
  if (score === null || score === undefined || !Number.isFinite(score) || score < 1 || score > 5) return 0.5;
  return 0.2 + (score - 1) * 0.2; // 1→0.2, 2→0.4, 3→0.6, 4→0.8, 5→1.0
}

/** Confidence 0..1 → pass-through (attribution güveni) */
export function getConfidenceWeight(confidence: number | null | undefined): number {
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) return 0.5;
  if (confidence < 0 || confidence > 1) return 0.5;
  return confidence;
}

/** Stage weight for V2..V5. V5 = 1.0 (sealed uses exact value). */
export function getStageWeight(stage: ProjectionStage): number {
  return STAGE_WEIGHTS[stage] ?? 0.02;
}

/**
 * Compute export value: V5 uses exact value_cents; V2–V4 use estimated formula.
 * estimated_value = base_value × stage_weight × quality_weight × confidence_weight
 */
export function computeExportValue(
  projection: ProjectionForValue,
  stage: ProjectionStage,
  baseAov: number,
  _policyVersion?: string
): number {
  if (stage === 'V5' && projection.value_cents != null && Number.isFinite(projection.value_cents)) {
    return Math.round(projection.value_cents) / 100; // cents → units
  }
  const sw = getStageWeight(stage);
  const qw = getQualityWeight(projection.quality_score);
  const cw = getConfidenceWeight(projection.confidence);
  const estimated = baseAov * sw * qw * cw;
  return Math.max(0.01, Math.round(estimated * 100) / 100); // floor 0.01 for Google Ads
}
