/**
 * Derive legacy attribution_source from Source Truth v2 (SSOT adapter).
 */

import type { TrafficClassificationV2 } from './truth-engine-types';

export function attributionSourceFromSourceTruth(t: TrafficClassificationV2): {
  source: string;
  isPaid: boolean;
} {
  if (t.is_fraud_suspected || t.channel === 'fraudulent_signal') {
    return { source: 'Organic', isPaid: false };
  }

  if (t.channel === 'dark_return' && t.is_paid) {
    return { source: 'Ads Assisted', isPaid: true };
  }

  if (t.is_paid && t.channel === 'paid_social') {
    return { source: 'Paid Social', isPaid: true };
  }

  if (t.is_paid && t.channel === 'paid_search') {
    if (t.identity_grade === 'click_id_assisted') {
      return { source: 'Ads Assisted', isPaid: true };
    }
    if (t.identity_grade === 'utm_only') {
      return { source: 'Paid (UTM)', isPaid: true };
    }
    return { source: 'First Click (Paid)', isPaid: true };
  }

  if (t.channel === 'direct') {
    return { source: 'Direct', isPaid: false };
  }

  return { source: 'Organic', isPaid: false };
}

/** Session organic-nulling: do not persist click IDs on non-paid channels. */
export function shouldNullClickIdsForSourceTruth(v2: TrafficClassificationV2): boolean {
  if (v2.is_fraud_suspected || v2.channel === 'fraudulent_signal') return true;
  if (v2.is_paid) return false;
  if (v2.channel === 'dark_return') return false;
  return true;
}
