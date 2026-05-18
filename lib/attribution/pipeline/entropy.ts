import type { ClassificationContext } from './context';

/** Deterministic ambiguity score 0..1 (not ML). */
export function computeSignalEntropy(ctx: ClassificationContext): number {
  let score = 0.1;
  const evidenceCount = ctx.selected_evidence.length;
  if (evidenceCount > 3) score += 0.1;
  if (ctx.ignored_evidence.length > 0) score += 0.15;
  score += Math.min(0.4, ctx.contradiction_score);
  if (!ctx.hasRawClickIdParam && ctx.verdict?.is_paid) score += 0.1;
  if (ctx.verdict?.channel === 'unknown') score += 0.25;
  return Math.min(1, Math.round(score * 1000) / 1000);
}

export function confidenceLabelFromScore(score: number): import('../truth-engine-types').ConfidenceLabel {
  if (score >= 0.95) return 'certain';
  if (score >= 0.75) return 'strong';
  if (score >= 0.55) return 'medium';
  if (score >= 0.3) return 'weak';
  return 'unknown';
}

export function confidenceScoreFromContext(ctx: ClassificationContext): number {
  let base = 0.5;
  if (ctx.sanitized.gclid || ctx.sanitized.wbraid || ctx.sanitized.gbraid) base = 0.92;
  else if (ctx.verdict?.channel === 'local_maps' && ctx.referrerHost) base = 0.72;
  else if (ctx.verdict?.channel === 'ai_referral') base = 0.58;
  else if (ctx.verdict?.channel === 'dark_return') base = 0.78;
  else if (ctx.verdict?.channel === 'direct') base = 0.35;
  base -= ctx.contradiction_score * 0.25;
  return Math.max(0, Math.min(1, Math.round(base * 1000) / 1000));
}
