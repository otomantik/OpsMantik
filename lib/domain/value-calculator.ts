/**
 * Pure Deterministic Value Calculator (VBB core)
 *
 * Design constraints:
 * - No I/O
 * - No database access
 * - No side effects
 * - Same input tuple -> same output
 */

/**
 * Canonical lead stages for offline conversion value mapping.
 */
export type LeadStage = 'junk' | 'contacted' | 'offered' | 'won';

/**
 * Operator multiplier input for a bounded, regularized multiplier:
 *
 *   M = 1 + alpha * (n / (n + k)) * z
 *   M := clamp(M, min, max)
 *
 * This keeps low-sample operators close to 1.0 and avoids runaway values.
 */
export interface OperatorFactorInput {
  n: number;
  z: number;
}

/**
 * Runtime-tunable multiplier parameters.
 */
export interface OperatorFactorConfig {
  alpha: number;
  k: number;
  min: number;
  max: number;
}

/**
 * Input contract for deterministic conversion value calculation.
 */
export interface ValueCalculationParams {
  stage: LeadStage;
  score: number;
  hasAnyClickId: boolean;
  hasConsent: boolean;
  operatorFactor?: OperatorFactorInput | null;
}

/**
 * Logistic multiplier constants:
 * Q = a + (b / (1 + exp(-c * (score - s0))))
 */
export const LOGISTIC_PARAMS = {
  a: 0.5,
  b: 1.0,
  c: 0.1,
  s0: 50,
} as const;

/**
 * Base value map in cents.
 *
 * junk intentionally maps to 10 cents (not zero) to feed negative-signal
 * training into smart bidding systems when consent is present.
 */
export const BASE_VALUE_CENTS: Record<LeadStage, number> = {
  junk: 10,
  contacted: 1000,
  offered: 5000,
  won: 20000,
};

/**
 * Default bounded shrinkage configuration for operator multiplier.
 */
export const DEFAULT_OPERATOR_FACTOR_CONFIG: OperatorFactorConfig = {
  alpha: 0.3,
  k: 50,
  min: 0.7,
  max: 1.3,
};

/**
 * Clamp score to [0, 100] and round to integer.
 */
export function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Logistic score multiplier in the closed interval [a, a+b].
 */
export function logisticScoreMultiplier(score: number): number {
  const s = normalizeScore(score);
  const { a, b, c, s0 } = LOGISTIC_PARAMS;
  return a + b / (1 + Math.exp(-c * (s - s0)));
}

/**
 * Compute bounded shrinkage multiplier from operator inputs.
 */
export function operatorMultiplier(
  operatorFactor?: OperatorFactorInput | null,
  config: OperatorFactorConfig = DEFAULT_OPERATOR_FACTOR_CONFIG
): number {
  if (!operatorFactor) return 1;
  const n = Number.isFinite(operatorFactor.n) ? Math.max(0, operatorFactor.n) : 0;
  const z = Number.isFinite(operatorFactor.z) ? operatorFactor.z : 0;
  const alpha = Number.isFinite(config.alpha) ? config.alpha : DEFAULT_OPERATOR_FACTOR_CONFIG.alpha;
  const k = Number.isFinite(config.k) && config.k > 0 ? config.k : DEFAULT_OPERATOR_FACTOR_CONFIG.k;
  const min = Number.isFinite(config.min) ? config.min : DEFAULT_OPERATOR_FACTOR_CONFIG.min;
  const max = Number.isFinite(config.max) ? config.max : DEFAULT_OPERATOR_FACTOR_CONFIG.max;
  const raw = 1 + alpha * (n / (n + k)) * z;
  return Math.max(min, Math.min(max, raw));
}

/**
 * Deterministic final conversion value in cents.
 *
 * Contract:
 * - If hasConsent is false -> returns exactly 0.
 * - Otherwise returns >= 1.
 */
export function calculateDeterministicConversionValue(
  params: ValueCalculationParams,
  config: OperatorFactorConfig = DEFAULT_OPERATOR_FACTOR_CONFIG
): number {
  // Queue-only model: click-id eligibility is enforced before queueing.
  if (!params.hasAnyClickId) return 0;
  if (!params.hasConsent) return 0;

  const base = BASE_VALUE_CENTS[params.stage];
  const q = logisticScoreMultiplier(params.score);
  const m = operatorMultiplier(params.operatorFactor, config);
  const rawValue = base * q * m;

  return Math.max(Math.round(rawValue), 1);
}

