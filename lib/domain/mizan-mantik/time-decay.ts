/**
 * MizanMantik 5-Gear — Time-Decay Math
 *
 * getBaseValueForGear: V1=0, V2=2%, V3=10%, V4=30%, V5 handled outside.
 * getDecayProfileForGear: Soft (V2), Standard (V3), Aggressive (V4).
 */

import type { OpsGear } from './types';

const MS_PER_DAY = 86400000;

/**
 * Base value for gear (V5 returns exact value outside this func).
 */
export function getBaseValueForGear(gear: OpsGear, aov: number): number {
  const safeAov = Number.isFinite(aov) && aov >= 0 ? aov : 100;
  switch (gear) {
    case 'V1_PAGEVIEW':
      return 0;
    case 'V2_PULSE':
      return safeAov * 0.02;
    case 'V3_ENGAGE':
      return safeAov * 0.1;
    case 'V4_INTENT':
      return safeAov * 0.3;
    case 'V5_SEAL':
      return 0; // Handled outside — exact valueCents
    default:
      return 0;
  }
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
 * Master EV for V2–V4 signals.
 * days = ceil(elapsedMs / 86400000)
 * EV = round(getBaseValueForGear * getDecayProfileForGear)
 */
export function calculateSignalEV(
  gear: OpsGear,
  aov: number,
  clickDate: Date,
  signalDate: Date
): number {
  if (gear === 'V1_PAGEVIEW') return 0;
  if (gear === 'V5_SEAL') return 0; // Handled by caller with valueCents

  const elapsedMs = Math.max(0, signalDate.getTime() - clickDate.getTime());
  const days = Math.ceil(elapsedMs / MS_PER_DAY);

  const base = getBaseValueForGear(gear, aov);
  const multiplier = getDecayProfileForGear(gear, days);

  return Math.round(base * multiplier * 100) / 100;
}
