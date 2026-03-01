/**
 * @deprecated Use lib/domain/mizan-mantik — MizanMantik 5-Gear Orchestrator.
 * Re-exports for backward compat (export route, predictive-engine).
 */

import { calculateSignalEV } from '@/lib/domain/mizan-mantik';
import type { OpsGear } from '@/lib/domain/mizan-mantik';

export const DEFAULT_AOV = 100.0;

export interface IntentWeights {
  junk: number;
  pending: number;
  qualified: number;
  sealed: number;
  [key: string]: number;
}

export const DEFAULT_INTENT_WEIGHTS: IntentWeights = {
  junk: 0.0,
  pending: 0.02,
  qualified: 0.2,
  sealed: 1.0,
};

export type ConversionSignalType = 'SEALED' | 'INTERMEDIATE';

export interface CalculateConversionValueParams {
  signalType: ConversionSignalType;
  valueCents?: number | null;
  aov?: number | null;
  intentStage?: string | null;
  intentWeights?: Record<string, number> | null;
  clickDate?: Date | null;
  signalDate?: Date | null;
}

/** Legacy intent weights (runner, export fallback) — NOT 5-gear. */
function getLegacyWeight(intentStage: string | null | undefined, weights: IntentWeights): number {
  const s = (intentStage || 'pending').toLowerCase();
  if (s === 'sealed' || s === 'won' || s === 'purchase') return weights.sealed ?? 1;
  if (s === 'qualified' || s === 'real') return weights.qualified ?? 0.2;
  if (s === 'pending' || s === 'open') return weights.pending ?? 0.02;
  if (s === 'junk' || s === 'lost') return weights.junk ?? 0;
  return 0;
}

/**
 * Unified conversion value — export route + runner (backward compat).
 * V5_SEAL: valueCents/100. INTERMEDIATE: legacy intent_weight × AOV (no 5-gear decay for queue/runner).
 */
export function calculateConversionValue(params: CalculateConversionValueParams): number {
  const { signalType, valueCents, aov, intentStage, intentWeights, clickDate, signalDate } = params;

  if (signalType === 'SEALED') {
    const cents = Number(valueCents);
    if (Number.isFinite(cents) && cents > 0) {
      return Math.round((cents / 100) * 100) / 100;
    }
  }

  const finalAov = (aov !== null && aov !== undefined && Number.isFinite(aov)) ? Number(aov) : DEFAULT_AOV;
  const w = intentWeights && typeof intentWeights === 'object' && !Array.isArray(intentWeights)
    ? { ...DEFAULT_INTENT_WEIGHTS, ...intentWeights }
    : DEFAULT_INTENT_WEIGHTS;
  const weight = getLegacyWeight(intentStage, w);
  const base = finalAov * weight;

  if (base <= 0) return 0;

  const sigDate = signalDate ?? new Date();
  const clkDate = clickDate;
  if (!clkDate || !(clkDate instanceof Date) || Number.isNaN(clkDate.getTime())) {
    return Math.round(base * 100) / 100;
  }

  const gear: OpsGear = (intentStage || 'pending').toLowerCase() === 'sealed' || (intentStage || '').toLowerCase() === 'won' || (intentStage || '').toLowerCase() === 'purchase'
    ? 'V4_INTENT'
    : (intentStage || 'pending').toLowerCase() === 'qualified' || (intentStage || '').toLowerCase() === 'real'
      ? 'V3_ENGAGE'
      : 'V2_PULSE';
  return calculateSignalEV(gear, finalAov, clkDate, sigDate);
}

/** @deprecated Use domain calculateSignalEV */
export function calculateDecayedValue(
  baseValue: number,
  clickDate: Date,
  signalDate: Date
): number {
  const aov = baseValue > 0 ? baseValue / 0.1 : 0;
  return calculateSignalEV('V3_ENGAGE', aov, clickDate, signalDate);
}
