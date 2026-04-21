/**
 * OptimizationStage — Canonical pipeline stage identifier.
 *
 * English-only as of the global launch cutover. The previous Turkish literals
 * (`gorusuldu`, `teklif`, `satis`) are no longer part of this union. If a
 * legacy string still needs to be tolerated at an external boundary (e.g. an
 * inbound webhook from a tenant that hasn't updated their integration),
 * collapse it through `normalizeStage()` in `@/lib/domain/stage-aliases`
 * BEFORE it touches the type system.
 */
export type OptimizationStage = 'junk' | 'contacted' | 'offered' | 'won';

export type HelperJobSize = 'kucuk' | 'orta' | 'buyuk';
export type HelperUrgency = 'dusuk' | 'orta' | 'yuksek';
export type HelperYesNo = 'evet' | 'hayir';
export type HelperFollowupExpectation = 'hayir' | 'belirsiz' | 'evet';

export interface HelperFormPayload {
  jobSize?: HelperJobSize | null;
  urgency?: HelperUrgency | null;
  priceDiscussed?: HelperYesNo | null;
  followupExpectation?: HelperFollowupExpectation | null;
  competitorComparison?: HelperYesNo | null;
}

/** SSOT defaults for operator helper form (canonical enum values; UI labels stay i18n). */
export const HELPER_FORM_DEFAULTS: HelperFormPayload = {
  jobSize: 'orta',
  urgency: 'orta',
  priceDiscussed: 'evet',
  followupExpectation: 'evet',
  competitorComparison: 'hayir',
};

export interface OptimizationValueSnapshot {
  optimizationStage: OptimizationStage;
  stageBase: number;
  systemScore: number;
  qualityFactor: number;
  optimizationValue: number;
  actualRevenue: number | null;
  helperFormPayload: HelperFormPayload | null;
  modelVersion: string;
}

export const OPTIMIZATION_MODEL_VERSION = 'universal-value-v1';

/**
 * Base optimization values keyed by stage. English-only — Turkish keys removed
 * as part of the global launch cutover.
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

export function resolveQualityFactor(systemScore: number): number {
  const score = clampSystemScore(systemScore);
  return roundToTwo(0.6 + 0.6 * (score / 100));
}

export function resolveStageBase(stage: OptimizationStage): number {
  return OPTIMIZATION_STAGE_BASES[stage];
}

export function resolveOptimizationValue(params: {
  stage: OptimizationStage;
  systemScore: number | null | undefined;
}): Pick<OptimizationValueSnapshot, 'stageBase' | 'systemScore' | 'qualityFactor' | 'optimizationValue'> {
  const stageBase = resolveStageBase(params.stage);
  const systemScore = clampSystemScore(params.systemScore);
  const qualityFactor = resolveQualityFactor(systemScore);

  return {
    stageBase,
    systemScore,
    qualityFactor,
    optimizationValue: roundToTwo(stageBase * qualityFactor),
  };
}

export function buildOptimizationSnapshot(params: {
  stage: OptimizationStage;
  systemScore: number | null | undefined;
  actualRevenue?: number | null;
  helperFormPayload?: HelperFormPayload | null;
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
    helperFormPayload: sanitizeHelperFormPayload(params.helperFormPayload ?? null),
    modelVersion: params.modelVersion?.trim() || OPTIMIZATION_MODEL_VERSION,
  };
}

/**
 * Resolve the canonical (English) optimization stage from an operator
 * actionType or a lead score.
 *
 * Legacy Turkish actionType spellings (`gorusuldu`, `teklif`, `satis`) are
 * accepted at the input boundary and collapsed to their English canonical
 * form, so a customer who hasn't cycled to the new UI build yet continues
 * to work. Everything the function RETURNS is English-only.
 */
export function resolveOptimizationStage(params: {
  actionType?: string | null;
  leadScore?: number | null;
}): OptimizationStage {
  const actionType = (params.actionType || '').trim().toLowerCase();
  if (actionType === 'junk') return 'junk';
  if (actionType === 'contacted' || actionType === 'gorusuldu') return 'contacted';
  if (actionType === 'offered' || actionType === 'teklif') return 'offered';
  if (actionType === 'won' || actionType === 'satis') return 'won';

  const leadScore = clampSystemScore(params.leadScore);
  if (leadScore <= 0) return 'junk';
  if (leadScore >= 100) return 'won';
  if (leadScore >= 80) return 'offered';
  return 'contacted';
}

export function sanitizeHelperFormPayload(payload: HelperFormPayload | null): HelperFormPayload | null {
  if (!payload) return null;

  const sanitized: HelperFormPayload = {
    jobSize: sanitizeEnum<HelperJobSize>(payload.jobSize, ['kucuk', 'orta', 'buyuk']),
    urgency: sanitizeEnum<HelperUrgency>(payload.urgency, ['dusuk', 'orta', 'yuksek']),
    priceDiscussed: sanitizeEnum<HelperYesNo>(payload.priceDiscussed, ['evet', 'hayir']),
    followupExpectation: sanitizeEnum<HelperFollowupExpectation>(payload.followupExpectation, ['hayir', 'belirsiz', 'evet']),
    competitorComparison: sanitizeEnum<HelperYesNo>(payload.competitorComparison, ['evet', 'hayir']),
  };

  return Object.values(sanitized).some((value) => value != null) ? sanitized : null;
}

function sanitizeEnum<T extends string>(value: T | null | undefined, allowed: readonly T[]): T | null {
  if (!value) return null;
  return allowed.includes(value) ? value : null;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
