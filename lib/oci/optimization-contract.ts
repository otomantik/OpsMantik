/**
 * CLOSED-SYSTEM SCORE CONTRACT (read before changing numbers or names)
 * -----------------------------------------------------------------
 * - `CATEGORICAL_SCORES` (25 / 60 / 100): **lead quality** training / UX inputs — not Google Ads value.
 * - `OPTIMIZATION_STAGE_BASES`: **stage economic base** in major units (won = 100 majors) — canonical conversion economics.
 * - `resolveOptimizationValue`: production **optimizationValue = stageBase** with `systemScore` forced to 0 — **no `lead_score` multiplier** on this path (intentional).
 * - **Truth / closure health** (audit gates) must never be written as conversion value; see `docs/architecture/CLOSED_SYSTEM_SCORE_CONTRACT.md`.
 */
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

/**
 * Optional "helper form" JSON context.
 * Used by some router paths to attach extra form metadata.
 */
export type HelperFormPayload = Record<string, unknown>;

export interface OptimizationValueSnapshot {
  optimizationStage: OptimizationStage;
  stageBase: number;
  systemScore: number;
  /** Production path: always 1.0 (lead_score does not scale majors here). */
  qualityFactor: number;
  optimizationValue: number;
  actualRevenue: number | null;
  /**
   * Optional helper payload for form-based signals.
   * Most callers do not provide form context, so we default to `null`.
   */
  helperFormPayload: HelperFormPayload | null;
  modelVersion: string;
}

export const OPTIMIZATION_MODEL_VERSION = 'dynamic-score-v2';

/** Explicit policy gate: Google conversion cents must not multiply by `lead_score` unless this is promoted via a separate PR. Production stays false. */
export const LEAD_SCORE_GOOGLE_VALUE_MULTIPLIER_ENABLED = false as const;

/**
 * Faz 1 — Tek kanun (kapalı sistem): `optimizationValue` üreten yol = yalnızca `resolveStageBase(stage)`.
 * Caller `systemScore` bu kanunda kullanılmaz (snapshotta 0 tutulur; `void` ile açık).
 */
export const CLOSED_SYSTEM_OPTIMIZATION_VALUE_LAW = 'stage_base_only_v1' as const;

/**
 * Base optimization values keyed by stage (major units before cent conversion).
 * The won base **100** is **stage economic** magnitude, not the operator **lead_score** HOT=100.
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
 * Calculates the optimization value — **Faz 1 single law**: `optimizationValue = stageBase` only.
 * `systemScore` is ignored for this result (`CLOSED_SYSTEM_OPTIMIZATION_VALUE_LAW`).
 */
export function resolveOptimizationValue(params: {
  stage: OptimizationStage;
  systemScore?: number | null | undefined;
}): Pick<OptimizationValueSnapshot, 'stageBase' | 'systemScore' | 'qualityFactor' | 'optimizationValue'> {
  void params.systemScore;
  const stageBase = resolveStageBase(params.stage);
  const systemScore = 0;
  const qualityFactor = 1.0;
  const optimizationValue = stageBase;

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
export function sanitizeHelperFormPayload(input: unknown): HelperFormPayload | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) return null;

  const obj = input as Record<string, unknown>;
  const out: HelperFormPayload = {};

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
