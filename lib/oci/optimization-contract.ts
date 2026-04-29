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
  /**
   * Optional helper payload for form-based signals.
   * Most callers do not provide form context, so we default to `null`.
   */
  helperFormPayload: Record<string, unknown> | null;
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
    helperFormPayload: null,
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

/**
 * Helper form payload genelde JSON olarak taşınır; burada sadece "safe"
 * JSON-serializable bir objeyi geri veriyoruz (aksi halde `null`).
 *
 * Amaç: Tip hatasını düzeltmek + beklenmeyen/şişkin payload'ların
 * DB'ye gitmesini engellemek.
 */
export function sanitizeHelperFormPayload(input: unknown): Record<string, unknown> | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) return null;

  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(obj)) {
    // JSON key güvenliği
    if (!k || typeof k !== 'string') continue;

    // Primitives
    if (v === null) {
      out[k] = null;
      continue;
    }
    if (typeof v === 'string') {
      const trimmed = v.trim();
      // Aşırı uzun string'leri kırp (DB storage / log spam)
      out[k] = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
      continue;
    }
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out[k] = v;
      continue;
    }
    if (typeof v === 'boolean') {
      out[k] = v;
      continue;
    }

    // Nested objects/arrays: çok derine inmeden sadece JSON-safe basit yapıları al
    if (Array.isArray(v)) {
      const safeArr: unknown[] = [];
      for (const item of v.slice(0, 50)) {
        if (
          item === null ||
          typeof item === 'string' ||
          typeof item === 'number' ||
          typeof item === 'boolean'
        ) {
          if (typeof item === 'string') {
            const t = item.trim();
            safeArr.push(t.length > 2000 ? t.slice(0, 2000) : t);
          } else if (typeof item === 'number') {
            if (Number.isFinite(item)) safeArr.push(item);
          } else {
            safeArr.push(item);
          }
        }
      }
      out[k] = safeArr;
      continue;
    }

    if (v && typeof v === 'object') {
      const nested = v as Record<string, unknown>;
      // Tek seviye nested destekle
      const nestedOut: Record<string, unknown> = {};
      for (const [nk, nv] of Object.entries(nested).slice(0, 50)) {
        if (!nk) continue;
        if (nv === null) nestedOut[nk] = null;
        else if (typeof nv === 'string') {
          const t = nv.trim();
          nestedOut[nk] = t.length > 2000 ? t.slice(0, 2000) : t;
        } else if (typeof nv === 'number' && Number.isFinite(nv)) nestedOut[nk] = nv;
        else if (typeof nv === 'boolean') nestedOut[nk] = nv;
      }
      out[k] = nestedOut;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
