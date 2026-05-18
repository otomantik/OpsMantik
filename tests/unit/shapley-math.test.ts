import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMarginalContribution,
  shapleyCreditRatioForChannel,
} from '@/lib/attribution/shapley-math';

test('Shapley sums to conversionValue', () => {
  const touchpoints = ['ai_referral', 'organic_search', 'paid_search'] as const;
  const value = 10000;
  const m = calculateMarginalContribution([...touchpoints], value);
  const sum = touchpoints.reduce((s, c) => s + (m[c] ?? 0), 0);
  assert.equal(Math.round(sum), value);
  assert.ok((m.paid_search ?? 0) > (m.ai_referral ?? 0));
});

test('Shapley replay deterministic', () => {
  const t = ['paid_search', 'local_maps'] as const;
  const a = calculateMarginalContribution([...t], 5000);
  const b = calculateMarginalContribution([...t], 5000);
  assert.deepEqual(a, b);
});

test('shapleyCreditRatioForChannel', () => {
  const m = calculateMarginalContribution(['paid_search', 'ai_referral'], 100);
  const ratio = shapleyCreditRatioForChannel(m, 'paid_search', 100);
  assert.ok(ratio > 0 && ratio <= 1);
});
