/**
 * Export Value Engine — computeExportValueCents()
 *
 * Pure function: given a gear, channel, site config, and timing inputs,
 * returns the exact integer cent value to send to Google Ads.
 *
 * Key rules:
 * - V5_SEAL: NEVER apply decay (hard rule, non-configurable). 1:1 explicit.
 * - V2/V3/V4: decay is configurable via config.decay (tiered/none/half_life/linear)
 * - signal_only mode: always returns signal_value * minor_units, no decay
 * - V1_PAGEVIEW: always 1 minor unit (visibility signal)
 *
 * Double Penalty Avoidance:
 * Google Smart Bidding's own conversion delay model already accounts for late-arriving
 * conversions. Applying our own decay on top penalizes the same delay twice.
 * Recommendation: sites using value_mode=explicit + V5 primary should set decay.mode=none.
 */

import { majorToMinor } from '@/lib/i18n/currency';
import {
  resolveConversionValueMinor,
  type OpsGear,
} from '@/lib/domain/mizan-mantik';
import type { SiteExportConfig, ChannelKey } from './site-export-config';

export interface ValueEngineInput {
  /** True click date: session.created_at, NOT call.created_at */
  clickDate: Date;
  /** Conversion event time */
  signalDate: Date;
  /** Sale amount in cents — only used for V5_SEAL explicit */
  saleAmountCents?: number | null;
  /** SHA-256 hashed phone — used for OCT (informational, not value calc) */
  hashedPhone?: string | null;
  /** SHA-256 hashed email — used for OCT (informational, not value calc) */
  hashedEmail?: string | null;
}

/**
 * Compute the conversion value in minor currency units (cents) for a given
 * gear × channel × site config combination.
 *
 * Returns a minimum of 1. Google Ads rejects value=0.
 */
export function computeExportValueCents(
  gear: OpsGear,
  channel: ChannelKey,
  config: SiteExportConfig,
  input: ValueEngineInput
): number {
  const effectiveMode = config.channel_value_mode?.[channel] ?? config.value_mode;

  // ── signal_only: flat signal value ─────────────────────────────────────
  // No decay, no AOV calculation. Google counts volume and learns tCPA.
  // All conversions equal weight → Maximize Conversions / tCPA works.
  if (effectiveMode === 'signal_only') {
    return Math.max(majorToMinor(config.signal_value, config.currency), 1);
  }

  // ── V1_PAGEVIEW: 1 minor unit ──────────────────────────────────────────
  // Visibility-only signal. No AOV multiplication.
  if (gear === 'V1_PAGEVIEW') {
    return 1;
  }

  // ── V5_SEAL: NEVER apply decay ─────────────────────────────────────────
  // RULE: V5 explicit value is sent 1:1 regardless of elapsed days.
  // This is non-configurable and non-overridable.
  // Rationale: Applying decay to an explicit sale amount distorts the true revenue
  // Google uses for tROAS. A deal closed 15 days after first click is still 5000 TRY.
  if (gear === 'V5_SEAL') {
    if (input.saleAmountCents && input.saleAmountCents > 0) {
      return input.saleAmountCents;
    }
    // V5 without sale amount: use fallback (no decay)
    return resolveConversionValueMinor({
      gear,
      currency: config.currency,
      saleAmountMinor: null,
      fallbackValueMajor: config.v5_fallback_value,
      minimumValueMinor: 1,
    }).valueMinor;
  }

  // ── V2/V3/V4: canonical AOV formula + canonical decay ─────────────────
  const channelAov = config.channel_aov?.[channel] ?? config.default_aov;
  const aovCents = majorToMinor(channelAov, config.currency);
  const weights = {
    pending: config.gear_weights.V2,
    qualified: config.gear_weights.V3,
    proposal: config.gear_weights.V4,
    sealed: 1,
  };
  return resolveConversionValueMinor({
    gear,
    currency: config.currency,
    siteAovMinor: aovCents,
    clickDate: input.clickDate,
    signalDate: input.signalDate,
    intentWeights: weights,
    applySignalFloor: true,
    minimumValueMinor: 1,
  }).valueMinor;
}
