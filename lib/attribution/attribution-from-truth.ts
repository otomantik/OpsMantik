/**
 * Phase 2 SSOT adapter — derive legacy attribution_source from Source Truth (not wired in P0).
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
  if (t.is_paid && t.channel === 'paid_search') {
    if (t.identity_grade === 'click_id_assisted') {
      return { source: 'Ads Assisted', isPaid: true };
    }
    return { source: 'First Click (Paid)', isPaid: true };
  }
  if (t.is_paid && t.channel === 'paid_social') {
    return { source: 'Paid Social', isPaid: true };
  }
  if (t.channel === 'direct' || t.channel === 'dark_return') {
    return t.is_paid
      ? { source: 'Ads Assisted', isPaid: true }
      : { source: 'Direct', isPaid: false };
  }
  return { source: 'Organic', isPaid: false };
}
