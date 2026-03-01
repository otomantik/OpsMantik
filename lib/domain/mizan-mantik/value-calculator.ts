/**
 * One True Math — SSOT for conversion value in minor units.
 *
 * V1: 0
 * V2–V4: AOV_site_minor × ratio × δ(gear, days) — training signals
 * V5: sale_amount_minor > 0 ? sale_amount_minor : 0 (no AOV, decay, lead_score)
 *
 * All values in integer minor units. Currency-aware via getMinorUnits.
 */

import { getMinorUnits, majorToMinor } from '@/lib/i18n/currency';
import { getDecayProfileForGear } from './time-decay';
import type { OpsGear } from './types';

const MS_PER_DAY = 86400000;

export const AOV_FLOOR_MAJOR = 1000;

const RATIO_BY_GEAR: Partial<Record<OpsGear, number>> = {
  V1_PAGEVIEW: 0,
  V2_PULSE: 0.02,
  V3_ENGAGE: 0.1,
  V4_INTENT: 0.3,
  V5_SEAL: 0, // Handled separately
};

export interface ConversionValueParams {
  gear: OpsGear;
  siteAovMinor?: number | null;
  currency?: string | null;
  clickDate?: Date | null;
  signalDate?: Date | null;
  saleAmountMinor?: number | null;
}

/**
 * Calculate conversion value in minor units.
 *
 * V1: 0
 * V2–V4: max(siteAovMinor, aovFloorMinor) × ratio × δ(gear, days)
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
}: ConversionValueParams): number {
  // V1: Always 0
  if (gear === 'V1_PAGEVIEW') {
    return 0;
  }

  // V5: Sale amount or 0 (no AOV, no decay)
  if (gear === 'V5_SEAL') {
    return saleAmountMinor != null && Number.isFinite(saleAmountMinor) && saleAmountMinor > 0
      ? saleAmountMinor
      : 0;
  }

  // V2–V4: AOV-based training signal
  const minorUnits = getMinorUnits(currency);
  const aovFloorMinor = majorToMinor(AOV_FLOOR_MAJOR, currency);
  const effectiveAovMinor = Math.max(siteAovMinor ?? 0, aovFloorMinor);

  const days = clampDays(clickDate, signalDate);
  const ratio = RATIO_BY_GEAR[gear] ?? 0;
  const decay = getDecayProfileForGear(gear, days);

  return Math.round(effectiveAovMinor * ratio * decay);
}

function clampDays(clickDate?: Date | null, signalDate?: Date | null): number {
  if (!clickDate || !signalDate) return 0;
  const diffMs = signalDate.getTime() - clickDate.getTime();
  const days = Math.floor(diffMs / MS_PER_DAY);
  return Math.min(3650, Math.max(0, days));
}
