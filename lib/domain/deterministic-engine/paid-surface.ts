/**
 * PR4-B — Map attribution / classifier outputs to a binary paid surface (shadow parity only).
 */

import type { AttributionResult } from '@/lib/attribution';
import type { TrafficClassification } from '@/lib/analytics/source-classifier';
import type { PaidSurfaceBucket } from '@/lib/domain/deterministic-engine/contract';

export function paidSurfaceFromAttributionResult(attribution: AttributionResult): PaidSurfaceBucket {
  return attribution.isPaid ? 'paid' : 'organic';
}

/**
 * PR4-B v1: Map `determineTrafficSource` output to binary bucket for parity with `computeAttribution.isPaid`.
 *
 * Assumptions (v1 — not universal marketing truth):
 * - `traffic_medium === 'cpc'` → paid (paid search / paid click-id paths in classifier).
 * - `traffic_medium === 'social'` → paid — **PR4-B v1 assumption** to align with `computeAttribution`
 *   treating social-referrer paid social as `isPaid: true`. Dashboards may use `social` differently; revisit in PR4-C+.
 * - `organic`, `direct`, `referral`, `unknown`, and any other non-cpc / non-social medium → organic for this binary.
 */
export function paidSurfaceFromTrafficClassificationV1(tc: TrafficClassification): PaidSurfaceBucket {
  const m = (tc.traffic_medium || '').toLowerCase();
  if (m === 'cpc') return 'paid';
  if (m === 'social') return 'paid';
  return 'organic';
}
