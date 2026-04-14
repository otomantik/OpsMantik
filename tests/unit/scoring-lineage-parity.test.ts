/**
 * PR4-E — Scoring lineage parity: classify + telemetry (flag-gated record helper).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyScoringLineageParity,
  recordScoringLineageParityTelemetry,
} from '@/lib/domain/deterministic-engine/scoring-lineage-parity';
import {
  getRefactorMetricsMemory,
  resetRefactorMetricsMemoryForTests,
} from '@/lib/refactor/metrics';

test('classifyScoringLineageParity: null session score => skipped', () => {
  assert.equal(classifyScoringLineageParity(50, null), 'skipped');
});

test('classifyScoringLineageParity: NaN session score => skipped', () => {
  assert.equal(classifyScoringLineageParity(50, NaN as unknown as number), 'skipped');
});

test('classifyScoringLineageParity: non-finite brain => skipped', () => {
  assert.equal(classifyScoringLineageParity(NaN, 50), 'skipped');
});

test('classifyScoringLineageParity: equal after round => match', () => {
  assert.equal(classifyScoringLineageParity(50, 50), 'match');
  assert.equal(classifyScoringLineageParity(50.1, 50.4), 'match');
});

test('classifyScoringLineageParity: different => mismatch', () => {
  assert.equal(classifyScoringLineageParity(80, 50), 'mismatch');
});

test('recordScoringLineageParityTelemetry: consolidated off => no metrics', () => {
  resetRefactorMetricsMemoryForTests();
  recordScoringLineageParityTelemetry({
    consolidatedEnabled: false,
    brainScore: 50,
    sessionV11FinalScore: 80,
    siteId: 's1',
    callId: 'c1',
  });
  const m = getRefactorMetricsMemory();
  assert.equal(m.truth_engine_scoring_lineage_parity_check_total, 0);
  assert.equal(m.truth_engine_scoring_lineage_parity_skipped_total, 0);
});

test('recordScoringLineageParityTelemetry: skipped path increments skipped only', () => {
  resetRefactorMetricsMemoryForTests();
  recordScoringLineageParityTelemetry({
    consolidatedEnabled: true,
    brainScore: 50,
    sessionV11FinalScore: null,
    siteId: 's1',
    callId: 'c1',
  });
  const m = getRefactorMetricsMemory();
  assert.equal(m.truth_engine_scoring_lineage_parity_skipped_total, 1);
  assert.equal(m.truth_engine_scoring_lineage_parity_check_total, 0);
});

test('recordScoringLineageParityTelemetry: match increments check + match', () => {
  resetRefactorMetricsMemoryForTests();
  recordScoringLineageParityTelemetry({
    consolidatedEnabled: true,
    brainScore: 65,
    sessionV11FinalScore: 65,
    siteId: 's1',
    callId: 'c1',
  });
  const m = getRefactorMetricsMemory();
  assert.equal(m.truth_engine_scoring_lineage_parity_check_total, 1);
  assert.equal(m.truth_engine_scoring_lineage_parity_match_total, 1);
  assert.equal(m.truth_engine_scoring_lineage_parity_mismatch_total, 0);
});

test('recordScoringLineageParityTelemetry: mismatch increments check + mismatch', () => {
  resetRefactorMetricsMemoryForTests();
  recordScoringLineageParityTelemetry({
    consolidatedEnabled: true,
    brainScore: 90,
    sessionV11FinalScore: 40,
    siteId: 's1',
    callId: 'c1',
  });
  const m = getRefactorMetricsMemory();
  assert.equal(m.truth_engine_scoring_lineage_parity_check_total, 1);
  assert.equal(m.truth_engine_scoring_lineage_parity_mismatch_total, 1);
  assert.equal(m.truth_engine_scoring_lineage_parity_match_total, 0);
});
