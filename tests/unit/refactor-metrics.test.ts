import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REFACTOR_METRIC_NAMES,
  getRefactorMetricsMemory,
  incrementRefactorMetric,
  resetRefactorMetricsMemoryForTests,
} from '@/lib/refactor/metrics';

test('REFACTOR_METRIC_NAMES has scaffold counters including typed-evidence fail and drift', () => {
  assert.ok(REFACTOR_METRIC_NAMES.length >= 26);
  assert.equal(new Set(REFACTOR_METRIC_NAMES).size, REFACTOR_METRIC_NAMES.length, 'metric names must stay unique');
  assert.ok(REFACTOR_METRIC_NAMES.includes('truth_typed_evidence_validation_fail_total'));
  assert.ok(REFACTOR_METRIC_NAMES.includes('truth_projection_drift_total'));
  assert.ok(REFACTOR_METRIC_NAMES.includes('consent_provenance_shadow_check_total'));
  assert.ok(REFACTOR_METRIC_NAMES.includes('truth_canonical_ledger_attempt_total'));
  assert.ok(REFACTOR_METRIC_NAMES.includes('truth_canonical_ledger_success_total'));
  assert.ok(REFACTOR_METRIC_NAMES.includes('truth_canonical_ledger_failure_total'));
  assert.ok(REFACTOR_METRIC_NAMES.includes('truth_engine_consolidated_probe_total'));
  assert.ok(REFACTOR_METRIC_NAMES.includes('truth_engine_consolidated_attribution_parity_check_total'));
  assert.ok(REFACTOR_METRIC_NAMES.includes('truth_engine_consolidated_call_event_parity_check_total'));
});

test('incrementRefactorMetric updates in-memory totals', () => {
  resetRefactorMetricsMemoryForTests();
  incrementRefactorMetric('truth_refactor_instrumented_touch_total', 3);
  assert.equal(getRefactorMetricsMemory().truth_refactor_instrumented_touch_total, 3);
});
