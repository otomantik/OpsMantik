/**
 * MizanMantik 5-Gear — Time-Decay Math (PR-VK-2: Config-driven ratios)
 *
 * getBaseValueForGear: V1=0, V2–V4 from intentWeights, V5 sealed (ratio=1.0, handled outside).
 * getDecayProfileForGear: Soft (V2), Standard (V3), Aggressive (V4).
 */

import { calculateDecayDays } from '@/lib/shared/time-utils';
import type { OpsGear } from './types';
import type { IntentWeights } from './value-config';

/** Gear → Stage mapping (Value SSOT Contract Rule D) */
export const GEAR_TO_STAGE: Record<OpsGear, keyof IntentWeights | null> = {
  V1_PAGEVIEW: null,
  V2_PULSE: 'pending',
  V3_ENGAGE: 'qualified',
  V4_INTENT: 'proposal',
  V5_SEAL: 'sealed',
};

const DEFAULT_WEIGHTS: IntentWeights = {
  pending: 0.02,
  qualified: 0.2,
  proposal: 0.3,
  sealed: 1.0,
};

/**
 * Base value for gear (V5 sealed returns 0 — handled outside with exact valueCents).
 * Uses intentWeights from DB; fallback to DEFAULT_WEIGHTS if key missing.
 */
export function getBaseValueForGear(
  gear: OpsGear,
  aov: number,
  intentWeights: IntentWeights = DEFAULT_WEIGHTS
): number {
  const safeAov = Number.isFinite(aov) && aov >= 0 ? aov : 0;
  const stage = GEAR_TO_STAGE[gear];
  if (!stage || gear === 'V1_PAGEVIEW') return 0;
  if (gear === 'V5_SEAL') return 0; // Handled outside — exact valueCents, ratio=1.0, decay=0
  const ratio = intentWeights[stage] ?? DEFAULT_WEIGHTS[stage];
  return safeAov * ratio;
}

/**
 * Decay multiplier by gear and days elapsed.
 * V2 Soft: 0.50 / 0.30 / 0.15
 * V3 Standard: 0.50 / 0.25 / 0.10
 * V4 Aggressive: 0.50 / 0.20 / 0.05
 */
export function getDecayProfileForGear(gear: OpsGear, days: number): number {
  switch (gear) {
    case 'V1_PAGEVIEW':
    case 'V5_SEAL':
      return 1; // No decay
    case 'V2_PULSE':
      if (days <= 3) return 0.5;
      if (days <= 10) return 0.3;
      return 0.15;
    case 'V3_ENGAGE':
      if (days <= 3) return 0.5;
      if (days <= 10) return 0.25;
      return 0.1;
    case 'V4_INTENT':
      if (days <= 3) return 0.5;
      if (days <= 10) return 0.2;
      return 0.05;
    default:
      return 0;
  }
}

/**
 * Half-life decay (MODULE 4 shadow): Value = BaseValue * (0.5 ^ (days/7))
 * Used in shadow mode for 30d comparison; not sent to Google until validated.
 */
export function applyHalfLifeDecay(baseValueCents: number, days: number): number {
  if (!Number.isFinite(baseValueCents) || baseValueCents <= 0) return 0;
  if (!Number.isFinite(days) || days < 0) return baseValueCents;
  const halfLife = 7;
  const exponent = days / halfLife;
  const multiplier = Math.pow(0.5, exponent);
  return Math.round(baseValueCents * multiplier);
}

/**
 * Master EV for V2–V4 signals (PR-VK-7: integer cents SSOT).
 * Returns integer cents only; no float. V5 sealed handled by caller.
 * Formula: baseValueCents = round(aovCents * ratio); finalCents = round(baseValueCents * decay).
 */
export function calculateSignalEV(
  gear: OpsGear,
  aovCents: number,
  clickDate: Date,
  signalDate: Date,
  intentWeights?: IntentWeights
): number {
  if (gear === 'V1_PAGEVIEW') return 0;
  if (gear === 'V5_SEAL') return 0; // Handled by caller with valueCents; ratio=1.0, decay=0

  const safeAovCents = Number.isFinite(aovCents) && aovCents >= 0 ? Math.round(aovCents) : 0;
  const ratio = getBaseValueForGear(gear, 1, intentWeights ?? DEFAULT_WEIGHTS);
  const days = calculateDecayDays(clickDate, signalDate, 'ceil');
  const decay = getDecayProfileForGear(gear, days);

  const baseValueCents = Math.round(safeAovCents * ratio);
  return Math.round(baseValueCents * decay);
}
