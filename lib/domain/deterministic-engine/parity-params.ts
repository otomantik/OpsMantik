/**
 * PR4-B — Build `params` for `determineTrafficSource` aligned with `computeAttribution` inputs.
 * Pure: merges sanitized gclid so classifier sees paid click-id when passed separately from URL.
 */

import type { AttributionInput } from '@/lib/attribution';

/**
 * Mirrors session-service keys passed into `determineTrafficSource` (subset available from sync worker).
 */
export function buildClassifierParamsForParity(input: {
  sanitizedGclid: string | null;
  utm: AttributionInput['utm'] | null;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.sanitizedGclid) {
    out.gclid = input.sanitizedGclid;
  }
  const u = input.utm;
  if (u) {
    if (u.medium != null) out.utm_medium = u.medium;
    if (u.source != null) out.utm_source = u.source;
    if (u.campaign != null) out.utm_campaign = u.campaign;
    if (u.term != null) out.utm_term = u.term;
    if (u.content != null) out.utm_content = u.content;
    if (u.adgroup != null) out.utm_adgroup = u.adgroup;
    if (u.matchtype != null) out.matchtype = u.matchtype;
    if (u.device != null) out.device = u.device;
    if (u.device_model != null) out.device_model = u.device_model;
    if (u.target_id != null) out.target_id = u.target_id;
    if (u.network != null) out.network = u.network;
    if (u.placement != null) out.placement = u.placement;
    if (u.adposition != null) out.adposition = u.adposition;
    if (u.feed_item_id != null) out.feed_item_id = u.feed_item_id;
    if (u.loc_interest_ms != null) out.loc_interest_ms = u.loc_interest_ms;
    if (u.loc_physical_ms != null) out.loc_physical_ms = u.loc_physical_ms;
  }
  return out;
}
