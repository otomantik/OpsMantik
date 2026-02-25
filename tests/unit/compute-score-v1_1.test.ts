/**
 * Unit tests for Scoring Brain V1.1: computeScoreV1_1 and deriveCallStatus.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeScoreV1_1,
  deriveCallStatus,
  BONUS_CAP,
  DED_NO_CLICK_ID,
  DED_FAST,
  DED_SINGLE,
} from '@/lib/scoring/compute-score-v1_1';

test('computeScoreV1_1: bonus dominance prevented — B=100 without events yields finalScore=40', () => {
  const out = computeScoreV1_1({
    conversionCount: 0,
    interactionCount: 0,
    bonusFromEvents: 100,
    hasClickId: true,
    elapsedSeconds: 120,
    eventCount: 3,
  });
  assert.equal(out.bonusesCapped, BONUS_CAP, 'bonusesCapped must be 40');
  assert.equal(out.finalScore, 40, 'finalScore must be 40 not 100');
  assert.equal(out.bonuses, 100, 'raw bonus preserved');
});

test('computeScoreV1_1: confidence deduction noClickId', () => {
  const out = computeScoreV1_1({
    conversionCount: 1,
    interactionCount: 2,
    bonusFromEvents: 0,
    hasClickId: false,
    elapsedSeconds: 120,
    eventCount: 5,
  });
  assert.equal(out.confidenceDeductions.noClickId, DED_NO_CLICK_ID);
  assert.equal(out.confidenceScore, 100 - DED_NO_CLICK_ID);
});

test('computeScoreV1_1: confidence deduction fast (elapsed < 30)', () => {
  const out = computeScoreV1_1({
    conversionCount: 0,
    interactionCount: 1,
    bonusFromEvents: 10,
    hasClickId: true,
    elapsedSeconds: 10,
    eventCount: 2,
  });
  assert.equal(out.confidenceDeductions.fast, DED_FAST);
  assert.equal(out.confidenceScore, 100 - DED_FAST);
});

test('computeScoreV1_1: confidence deduction single (eventCount <= 1)', () => {
  const out = computeScoreV1_1({
    conversionCount: 0,
    interactionCount: 0,
    bonusFromEvents: 0,
    hasClickId: true,
    elapsedSeconds: 60,
    eventCount: 1,
  });
  assert.equal(out.confidenceDeductions.single, DED_SINGLE);
  assert.equal(out.confidenceScore, 100 - DED_SINGLE);
});

test('computeScoreV1_1: confidence clamped to [0, 100]', () => {
  const out = computeScoreV1_1({
    conversionCount: 0,
    interactionCount: 0,
    bonusFromEvents: 0,
    hasClickId: false,
    elapsedSeconds: 5,
    eventCount: 1,
  });
  const totalDed = DED_NO_CLICK_ID + DED_FAST + DED_SINGLE;
  assert.equal(out.confidenceScore, Math.max(0, 100 - totalDed));
  assert.ok(out.confidenceScore >= 0 && out.confidenceScore <= 100);
});

test('computeScoreV1_1: inputsSnapshot has stable keys', () => {
  const out = computeScoreV1_1({
    conversionCount: 1,
    interactionCount: 2,
    bonusFromEvents: 30,
    hasClickId: true,
    elapsedSeconds: 90,
    eventCount: 3,
  });
  const snap = out.inputsSnapshot;
  assert.equal(typeof snap.n_conv, 'number');
  assert.equal(typeof snap.n_int, 'number');
  assert.equal(typeof snap.event_count, 'number');
  assert.equal(typeof snap.has_click_id, 'boolean');
  assert.equal(typeof snap.elapsed_seconds, 'number');
  assert.equal(typeof snap.bonus_raw, 'number');
  assert.equal(snap.bonus_cap, BONUS_CAP);
  assert.equal(typeof snap.bonus_capped, 'number');
  assert.ok(snap.confidence_deductions && typeof snap.confidence_deductions === 'object');
});

test('deriveCallStatus: elapsedSeconds=10 => suspicious', () => {
  const out = computeScoreV1_1({
    conversionCount: 1,
    interactionCount: 2,
    bonusFromEvents: 20,
    hasClickId: true,
    elapsedSeconds: 10,
    eventCount: 3,
  });
  assert.equal(deriveCallStatus(out), 'suspicious');
});

test('deriveCallStatus: elapsedSeconds=180 and confidence 80 => intent', () => {
  const out = computeScoreV1_1({
    conversionCount: 2,
    interactionCount: 3,
    bonusFromEvents: 30,
    hasClickId: true,
    elapsedSeconds: 180,
    eventCount: 5,
  });
  assert.ok(out.confidenceScore >= 50);
  assert.equal(deriveCallStatus(out), 'intent');
});

test('deriveCallStatus: confidence < 50 => suspicious (noClickId + single + fast)', () => {
  const out = computeScoreV1_1({
    conversionCount: 0,
    interactionCount: 0,
    bonusFromEvents: 0,
    hasClickId: false,
    elapsedSeconds: 10,
    eventCount: 1,
  });
  // noClickId 25 + fast 20 + single 10 = 55 → confidence 45
  assert.ok(out.confidenceScore < 50, `confidence ${out.confidenceScore} must be < 50`);
  assert.equal(deriveCallStatus(out), 'suspicious');
});

test('computeScoreV1_1: version is v1.1', () => {
  const out = computeScoreV1_1({
    conversionCount: 0,
    interactionCount: 0,
    bonusFromEvents: 0,
    hasClickId: true,
    elapsedSeconds: 100,
    eventCount: 2,
  });
  assert.equal(out.version, 'v1.1');
});
