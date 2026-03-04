/**
 * One True Math — SSOT for conversion value in minor units.
 *
 * V1: 0
 * V2–V4: AOV_site_minor × ratio × δ(gear, days) — training signals (PR-VK-2: intentWeights from DB)
 * V5: sale_amount_minor > 0 ? sale_amount_minor : 0 (no AOV, decay, lead_score)
 *
 * All values in integer minor units. Currency-aware via getMinorUnits.
 */

import { majorToMinor } from '@/lib/i18n/currency';
import { calculateDecayDays } from '@/lib/shared/time-utils';
import { getBaseValueForGear, getDecayProfileForGear } from './time-decay';
import type { IntentWeights } from './value-config';
import { DEFAULT_WEIGHTS } from './value-config';
import type { OpsGear } from './types';

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
  /** Intent stage weights (DB: sites.intent_weights). Default: pending 2%, qualified 20%, proposal 30%, sealed 100%. */
  intentWeights?: IntentWeights | null;
}

/**
 * Calculate conversion value in minor units.
 *
 * V1: 0
 * V2–V4: max(siteAovMinor, aovFloorMinor) × ratio × δ(gear, days) — ratio from intentWeights
 * V5: saleAmountMinor > 0 ? saleAmountMinor : 0
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
  intentWeights,
}: ConversionValueParams): number {
  const aovFloorMinor =
    minConversionValueCents != null && Number.isFinite(minConversionValueCents)
      ? minConversionValueCents
      : majorToMinor(AOV_FLOOR_MAJOR, currency ?? 'TRY');

  // V1: Never return 0. Return 1 minor unit (0.01 TL) for DDA visibility.
  if (gear === 'V1_PAGEVIEW') {
    return 1;
  }

  // V5: Sale amount or aovFloorMinor fallback (The 1000 TL Axiom)
  if (gear === 'V5_SEAL') {
    return saleAmountMinor != null && Number.isFinite(saleAmountMinor) && saleAmountMinor > 0
      ? saleAmountMinor
      : aovFloorMinor;
  }

  // V2–V4: AOV-based training signal (ratio from intentWeights; floor from DB or fallback)
  const effectiveAovMinor = Math.max(siteAovMinor ?? 0, aovFloorMinor);
  const ratio =
    getBaseValueForGear(gear, 1, intentWeights ?? DEFAULT_WEIGHTS) || 0;

  const days =
    clickDate && signalDate
      ? calculateDecayDays(clickDate, signalDate, 'ceil')
      : 0;
  const decay = getDecayProfileForGear(gear, days);

  return Math.round(effectiveAovMinor * ratio * decay);
}
