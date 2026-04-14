/**
 * One True Math — SSOT for conversion value in minor units.
 *
 * V1: 1 minor unit visibility value
 * V2–V4: AOV_site_minor × ratio × δ(gear, days) — training signals (PR-VK-2: intentWeights from DB)
 * V5: sale_amount_minor > 0 ? sale_amount_minor : minConversionValueCents fallback
 *
 * All values in integer minor units. Currency-aware via getMinorUnits.
 */

import { majorToMinor } from '@/lib/i18n/currency';
import { calculateDecayDays } from '@/lib/shared/time-utils';
import { getBaseValueForGear, getDecayProfileForGear } from './time-decay';
import type { IntentWeights } from './value-config';
import { DEFAULT_WEIGHTS, normalizeWeight, resolveFallbackMinor } from './value-config';
import type { OpsGear } from './types';

export type { ProjectionForValue, ProjectionStage } from '../funnel-kernel/funnel-policy';

/** @deprecated Use minConversionValueCents param (DB-driven). Default 100000 = 1000 TRY. */
export const AOV_FLOOR_MAJOR = 1000;

export interface ConversionValueParams {
  gear: OpsGear;
  siteAovMinor?: number | null;
  currency?: string | null;
  clickDate?: Date | null;
  signalDate?: Date | null;
  saleAmountMinor?: number | null;
  /** Min conversion value in cents (DB: sites.min_conversion_value_cents). Default 100000. */
  minConversionValueCents?: number | null;
  /** Export-config fallback value in major units. Used when DB fallback is absent. */
  fallbackValueMajor?: number | null;
  /** Intent stage weights (DB: sites.intent_weights). Default: pending 2%, qualified 20%, proposal 30%, sealed 100%. */
  intentWeights?: IntentWeights | null;
  /** Optional explicit ratio for score-based/manual flows. Accepts 0..1 or 0..100. */
  ratioOverride?: number | null;
  /** Optional explicit decay override for manual flows. */
  decayOverride?: number | null;
  /** Apply small signal floor for V2–V4 so Google never sees near-zero training values. */
  applySignalFloor?: boolean;
  /** Override minimum non-zero minor value after all math. */
  minimumValueMinor?: number | null;
}

export interface ResolvedConversionValue {
  valueMinor: number;
  baseValueMinor: number;
  ratio: number;
  decay: number;
  fallbackMinor: number;
}

export function resolveSignalFloorMinor(siteAovMinor?: number | null): number {
  const safeAovMinor = Number.isFinite(siteAovMinor) ? Math.max(0, Math.round(siteAovMinor ?? 0)) : 0;
  return Math.max(Math.round(safeAovMinor * 0.005), 1);
}

export function resolveConversionValueMinor({
  gear,
  siteAovMinor,
  currency = 'TRY',
  clickDate,
  signalDate,
  saleAmountMinor,
  minConversionValueCents,
  fallbackValueMajor,
  intentWeights,
  ratioOverride,
  decayOverride,
  applySignalFloor = false,
  minimumValueMinor,
}: ConversionValueParams): ResolvedConversionValue {
  const fallbackMinor = resolveFallbackMinor({
    currency,
    minConversionValueCents,
    v5FallbackValueMajor: fallbackValueMajor,
  });
  const minimumMinor =
    minimumValueMinor != null && Number.isFinite(minimumValueMinor)
      ? Math.max(0, Math.round(minimumValueMinor))
      : 0;

  if (gear === 'V1_PAGEVIEW') {
    return {
      valueMinor: 1,
      baseValueMinor: 1,
      ratio: 0,
      decay: 1,
      fallbackMinor,
    };
  }

  if (gear === 'V5_SEAL') {
    const sealedValueMinor =
      saleAmountMinor != null && Number.isFinite(saleAmountMinor) && saleAmountMinor > 0
        ? Math.round(saleAmountMinor)
        : fallbackMinor;
    return {
      valueMinor: Math.max(sealedValueMinor, Math.max(minimumMinor, 1)),
      baseValueMinor: sealedValueMinor,
      ratio: 1,
      decay: 1,
      fallbackMinor,
    };
  }

  const effectiveAovMinor = Math.max(siteAovMinor ?? 0, 0);
  const ratio =
    ratioOverride != null
      ? normalizeWeight(ratioOverride)
      : getBaseValueForGear(gear, 1, intentWeights ?? DEFAULT_WEIGHTS) || 0;
  const baseValueMinor = Math.round(effectiveAovMinor * ratio);
  const days =
    clickDate && signalDate
      ? calculateDecayDays(clickDate, signalDate, 'ceil')
      : 0;
  const decay =
    decayOverride != null && Number.isFinite(decayOverride)
      ? Math.max(0, decayOverride)
      : getDecayProfileForGear(gear, days);
  const decayedValueMinor = Math.round(baseValueMinor * decay);
  const flooredValueMinor = applySignalFloor
    ? Math.max(decayedValueMinor, resolveSignalFloorMinor(effectiveAovMinor))
    : decayedValueMinor;

  return {
    valueMinor: Math.max(flooredValueMinor, minimumMinor),
    baseValueMinor,
    ratio,
    decay,
    fallbackMinor,
  };
}

/**
 * Calculate conversion value in minor units.
 *
 * V1: 1 minor unit
 * V2–V4: siteAovMinor × ratio × δ(gear, days) with a small signal floor
 * V5: saleAmountMinor > 0 ? saleAmountMinor : minConversionValueCents fallback
 *
 * @returns value in minor units (integer)
 */
export function calculateConversionValueMinor({
  gear,
  siteAovMinor,
  currency = 'TRY',
  clickDate,
  signalDate,
  saleAmountMinor,
  minConversionValueCents,
  fallbackValueMajor,
  intentWeights,
  ratioOverride,
  decayOverride,
  applySignalFloor,
  minimumValueMinor,
}: ConversionValueParams): number {
  return resolveConversionValueMinor({
    gear,
    siteAovMinor,
    currency,
    clickDate,
    signalDate,
    saleAmountMinor,
    minConversionValueCents:
      minConversionValueCents != null && Number.isFinite(minConversionValueCents)
        ? minConversionValueCents
        : majorToMinor(AOV_FLOOR_MAJOR, currency ?? 'TRY'),
    fallbackValueMajor,
    intentWeights,
    ratioOverride,
    decayOverride,
    applySignalFloor,
    minimumValueMinor,
  }).valueMinor;
}

/**
 * COMPATIBILITY LAYER (Industrial Grade)
 * These functions preserve backward compatibility with the legacy funnel-kernel.
 */

/**
 * V5 exact value normalization.
 */
export function computeSealedValue(exactValueCents: number): number {
  if (!Number.isFinite(exactValueCents) || exactValueCents < 0) return 0.01;
  return Math.round(exactValueCents) / 100;
}
