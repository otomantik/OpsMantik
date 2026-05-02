import type { OptimizationStage } from '@/lib/oci/optimization-contract';

/**
 * Google Ads conversion action names, keyed by OptimizationStage.
 *
 * IMPORTANT — The VALUES below are the literal Google Ads conversion action
 * names registered in each customer's Google Ads account. The canonical
 * naming scheme is English-only:
 *
 *   junk       → OpsMantik_Junk_Exclusion (exclusion/negative-quality in Google Ads; fixed
 *                 nominal upload value is technical only — not a positive ROAS signal)
 *   contacted  → OpsMantik_Contacted
 *   offered    → OpsMantik_Offered
 *   won        → OpsMantik_Won
 *
 * Operational prerequisite: every active Google Ads account MUST have these
 * four conversion actions created (with the same names, matching currency,
 * "Enter a value for each conversion" setting, attribution model, and
 * click-through / engaged-view window) BEFORE this build is deployed.
 * Mismatches surface as `400 CONVERSION_ACTION_NOT_FOUND` in the OCI
 * upload response and are idempotent-safely retried by the outbox worker.
 */
export const OPSMANTIK_CONVERSION_NAMES: Record<OptimizationStage, string> = {
  junk: 'OpsMantik_Junk_Exclusion',
  contacted: 'OpsMantik_Contacted',
  offered: 'OpsMantik_Offered',
  won: 'OpsMantik_Won',
};

export function resolveOciConversionName(stage: OptimizationStage): string {
  return OPSMANTIK_CONVERSION_NAMES[stage];
}

export function isOciCanonicalStage(value: string): value is OptimizationStage {
  return Object.prototype.hasOwnProperty.call(OPSMANTIK_CONVERSION_NAMES, value);
}
