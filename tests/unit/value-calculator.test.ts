import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_VALUE_CENTS,
  DEFAULT_OPERATOR_FACTOR_CONFIG,
  calculateDeterministicConversionValue,
  logisticScoreMultiplier,
  normalizeScore,
  operatorMultiplier,
  type LeadStage,
} from '@/lib/domain/value-calculator';

test('consent cutoff returns exactly 0', () => {
  const stages: LeadStage[] = ['junk', 'contacted', 'offered', 'won'];
  for (const stage of stages) {
    const value = calculateDeterministicConversionValue({
      stage,
      score: 100,
      hasAnyClickId: true,
      hasConsent: false,
    });
    assert.equal(value, 0);
  }
});

test('junk negative signal never returns 0 when consent true', () => {
  const low = calculateDeterministicConversionValue({
    stage: 'junk',
    score: 0,
    hasAnyClickId: true,
    hasConsent: true,
  });
  const high = calculateDeterministicConversionValue({
    stage: 'junk',
    score: 100,
    hasAnyClickId: true,
    hasConsent: true,
  });
  assert.ok(low >= 1);
  assert.ok(high >= 1);
  assert.ok(low < 50, 'junk should stay micro-value');
  assert.ok(high < 50, 'junk should stay micro-value even at high score');
});

test('logistic multiplier differentiates mid vs high score', () => {
  const mid = logisticScoreMultiplier(50);
  const high = logisticScoreMultiplier(90);
  assert.ok(high > mid);
});

test('missing click-id is rejected by queue-only model', () => {
  const withClick = calculateDeterministicConversionValue({
    stage: 'offered',
    score: 80,
    hasAnyClickId: true,
    hasConsent: true,
  });
  const withoutClick = calculateDeterministicConversionValue({
    stage: 'offered',
    score: 80,
    hasAnyClickId: false,
    hasConsent: true,
  });
  assert.ok(withClick > 0);
  assert.equal(withoutClick, 0);
});

test('determinism: same tuple always returns same value', () => {
  const params = {
    stage: 'won' as const,
    score: 73,
    hasAnyClickId: true,
    hasConsent: true,
    operatorFactor: { n: 40, z: 0.35 },
  };
  const first = calculateDeterministicConversionValue(params);
  for (let i = 0; i < 1000; i += 1) {
    assert.equal(calculateDeterministicConversionValue(params), first);
  }
});

test('score normalization clamps and rounds', () => {
  assert.equal(normalizeScore(-10), 0);
  assert.equal(normalizeScore(44.6), 45);
  assert.equal(normalizeScore(101), 100);
  assert.equal(normalizeScore(Number.NaN), 0);
});

test('operator multiplier is bounded and shrinkage-aware', () => {
  const cfg = DEFAULT_OPERATOR_FACTOR_CONFIG;
  const baseline = operatorMultiplier(null, cfg);
  const lowN = operatorMultiplier({ n: 1, z: 1.0 }, cfg);
  const highN = operatorMultiplier({ n: 1000, z: 1.0 }, cfg);
  const cappedHigh = operatorMultiplier({ n: 1000, z: 999 }, cfg);
  const cappedLow = operatorMultiplier({ n: 1000, z: -999 }, cfg);

  assert.equal(baseline, 1);
  assert.ok(highN > lowN, 'high sample should move more than low sample');
  assert.ok(cappedHigh <= cfg.max);
  assert.ok(cappedLow >= cfg.min);
});

test('monotonicity for fixed stage and guards', () => {
  const seq = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((s) =>
    calculateDeterministicConversionValue({
      stage: 'contacted',
      score: s,
      hasAnyClickId: true,
      hasConsent: true,
      operatorFactor: { n: 200, z: 0.2 },
    })
  );

  for (let i = 1; i < seq.length; i += 1) {
    assert.ok(seq[i] >= seq[i - 1], `value must be non-decreasing at index ${i}`);
  }
});

test('base map sanity', () => {
  assert.equal(BASE_VALUE_CENTS.junk, 10);
  assert.equal(BASE_VALUE_CENTS.contacted, 1000);
  assert.equal(BASE_VALUE_CENTS.offered, 5000);
  assert.equal(BASE_VALUE_CENTS.won, 20000);
});

