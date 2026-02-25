/**
 * Scoring Brain V1.1 — Pure function, zero side effects.
 * Bonus saturation cap (B ≤ 40) + linear confidence with explicit deductions.
 */

export const BONUS_CAP = 40;
export const DED_NO_CLICK_ID = 25;
export const DED_FAST = 20; // elapsedSeconds < 30
export const DED_SINGLE = 10; // eventCount <= 1

export interface ComputeScoreV1_1Inputs {
  conversionCount: number;
  interactionCount: number;
  bonusFromEvents: number;
  hasClickId: boolean;
  elapsedSeconds: number;
  eventCount: number;
}

export interface ConfidenceDeductions {
  noClickId: number;
  fast: number;
  single: number;
}

export interface InputsSnapshot {
  n_conv: number;
  n_int: number;
  event_count: number;
  has_click_id: boolean;
  elapsed_seconds: number;
  bonus_raw: number;
  bonus_cap: number;
  bonus_capped: number;
  confidence_deductions: ConfidenceDeductions;
}

export interface ComputeScoreV1_1Output {
  version: 'v1.1';
  conversionPoints: number;
  interactionPoints: number;
  bonuses: number;
  bonusesCapped: number;
  bonusCap: number;
  rawScore: number;
  finalScore: number;
  cappedAt100: boolean;
  confidenceScore: number;
  confidenceDeductions: ConfidenceDeductions;
  elapsedSeconds: number;
  inputsSnapshot: InputsSnapshot;
}

/**
 * Compute quality score and confidence (V1.1). Pure function.
 */
export function computeScoreV1_1(inputs: ComputeScoreV1_1Inputs): ComputeScoreV1_1Output {
  const {
    conversionCount,
    interactionCount,
    bonusFromEvents,
    hasClickId,
    elapsedSeconds,
    eventCount,
  } = inputs;

  const conversionPoints = conversionCount * 20;
  const interactionPoints = interactionCount * 5;
  const bonusRaw = Math.max(0, bonusFromEvents);
  const bonusesCapped = Math.min(bonusRaw, BONUS_CAP);
  const rawScore = conversionPoints + interactionPoints + bonusesCapped;
  const finalScore = Math.min(rawScore, 100);
  const cappedAt100 = rawScore > 100;

  const noClickId = !hasClickId ? DED_NO_CLICK_ID : 0;
  const fast = elapsedSeconds < 30 ? DED_FAST : 0;
  const single = eventCount <= 1 ? DED_SINGLE : 0;
  const confidenceDeductions: ConfidenceDeductions = { noClickId, fast, single };
  let confidence = 100 - noClickId - fast - single;
  confidence = Math.max(0, Math.min(100, confidence));

  const inputsSnapshot: InputsSnapshot = {
    n_conv: conversionCount,
    n_int: interactionCount,
    event_count: eventCount,
    has_click_id: hasClickId,
    elapsed_seconds: elapsedSeconds,
    bonus_raw: bonusRaw,
    bonus_cap: BONUS_CAP,
    bonus_capped: bonusesCapped,
    confidence_deductions: confidenceDeductions,
  };

  return {
    version: 'v1.1',
    conversionPoints,
    interactionPoints,
    bonuses: bonusRaw,
    bonusesCapped,
    bonusCap: BONUS_CAP,
    rawScore,
    finalScore,
    cappedAt100,
    confidenceScore: confidence,
    confidenceDeductions,
    elapsedSeconds,
    inputsSnapshot,
  };
}

/**
 * Derive callStatus from V1.1 output: suspicious if elapsed < 120s OR confidence < 50.
 */
export function deriveCallStatus(output: ComputeScoreV1_1Output): 'suspicious' | 'intent' {
  if (output.elapsedSeconds < 120) return 'suspicious';
  if (output.confidenceScore < 50) return 'suspicious';
  return 'intent';
}
