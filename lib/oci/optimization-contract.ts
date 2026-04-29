/**
 * OptimizationStage — Canonical pipeline stage identifier.
 */
/**
 * Standardized scores for algorithm training (Categorical Model)
 */
export const CATEGORICAL_SCORES = {
  COLD: 25,
  NORMAL: 60,
  HOT: 100,
} as const;

export type OptimizationStage = 'junk' | 'contacted' | 'offered' | 'won';

export interface OptimizationValueSnapshot {
  optimizationStage: OptimizationStage;
  stageBase: number;
  systemScore: number;
  /** Universal multiplier derived from systemScore (0..100). */
  qualityFactor: number;
  optimizationValue: number;
  actualRevenue: number | null;
  modelVersion: string;
}

export const OPTIMIZATION_MODEL_VERSION = 'dynamic-score-v2';

/**
 * Base optimization values keyed by stage.
 * These are the maximum values for each stage (when score is 100).
 */
export const OPTIMIZATION_STAGE_BASES: Record<OptimizationStage, number> = {
  junk: 0.1,
  contacted: 10,
  offered: 50,
  won: 100,
};

export function clampSystemScore(input: number | null | undefined): number {
  if (!Number.isFinite(input)) return 0;
  return Math.max(0, Math.min(100, Math.round(input ?? 0)));
}

export function resolveStageBase(stage: OptimizationStage): number {
  return OPTIMIZATION_STAGE_BASES[stage];
}

/**
 * Universal quality multiplier.
 *
 * Test-verified formula:
 * - systemScore 0   => 0.6
 * - systemScore 50  => 0.9
 * - systemScore 100 => 1.2
 */
export function resolveQualityFactor(systemScore: number | null | undefined): number {
  const s = clampSystemScore(systemScore);
  // qualityFactor = 0.6 * (1 + s/100)
  return roundToTwo(0.6 * (1 + s / 100));
}

/**
 * Calculates the optimization value based on stage and system score.
 *
 * optimizationValue = stageBase * qualityFactor(systemScore)
 */
export function resolveOptimizationValue(params: {
  stage: OptimizationStage;
  systemScore: number | null | undefined;
}): Pick<OptimizationValueSnapshot, 'stageBase' | 'systemScore' | 'qualityFactor' | 'optimizationValue'> {
  const stageBase = resolveStageBase(params.stage);
  const systemScore = clampSystemScore(params.systemScore);
  const qualityFactor = resolveQualityFactor(systemScore);
  const optimizationValue = roundToTwo(stageBase * qualityFactor);

  return {
    stageBase,
    systemScore,
    qualityFactor,
    optimizationValue,
  };
}

export function buildOptimizationSnapshot(params: {
  stage: OptimizationStage;
  systemScore: number | null | undefined;
  actualRevenue?: number | null;
  modelVersion?: string | null;
}): OptimizationValueSnapshot {
  const resolved = resolveOptimizationValue({
    stage: params.stage,
    systemScore: params.systemScore,
  });

  return {
    optimizationStage: params.stage,
    stageBase: resolved.stageBase,
    systemScore: resolved.systemScore,
    qualityFactor: resolved.qualityFactor,
    optimizationValue: resolved.optimizationValue,
    actualRevenue:
      params.actualRevenue != null && Number.isFinite(params.actualRevenue) && params.actualRevenue >= 0
        ? roundToTwo(params.actualRevenue)
        : null,
    modelVersion: params.modelVersion?.trim() || OPTIMIZATION_MODEL_VERSION,
  };
}

/**
 * Resolve the canonical (English) optimization stage from an operator
 * actionType or a lead score.
 */
export function resolveOptimizationStage(params: {
  actionType?: string | null;
  leadScore?: number | null;
}): OptimizationStage {
  const actionType = (params.actionType || '').trim().toLowerCase();
  if (actionType === 'junk') return 'junk';
  if (actionType === 'contacted') return 'contacted';
  if (actionType === 'offered') return 'offered';
  if (actionType === 'won') return 'won';

  const leadScore = clampSystemScore(params.leadScore);
  if (leadScore <= 0) return 'junk';
  if (leadScore >= 100) return 'won';
  if (leadScore >= 80) return 'offered';
  return 'contacted';
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
