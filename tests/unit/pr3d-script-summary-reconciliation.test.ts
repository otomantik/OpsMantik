import test from 'node:test';
import assert from 'node:assert';
import { validateScriptSummaryShape, evaluateReconciliation, ScriptSummaryPayload } from '@/lib/oci/export-run-reconciliation';

test('PR-3D Script Summary: rejects non-finite optional counts', () => {
  const payload = {
    summary_version: '1.0',
    export_run_id: 'oci_run_neg_ack',
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
    ack_success_count: Number.NaN,
  };
  const result = validateScriptSummaryShape(payload);
  assert.strictEqual(result.ok, false);
  assert.match(result.error || '', /Invalid optional integer field: ack_success_count/);
});

test('PR-3D Script Summary: malformed summary returns SCRIPT_SUMMARY_INVALID', () => {
  const payload = {
    summary_version: '1.0',
    export_run_id: 'oci_run_missing_upload',
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    // upload_attempted_count missing
  };
  const result = validateScriptSummaryShape(payload);
  assert.strictEqual(result.ok, false);
  assert.match(result.error || '', /Missing or invalid required integer field: upload_attempted_count/);
});

test('PR-3D Script Summary: valid summary returns SCRIPT_SUMMARY_RECEIVED (with incomplete proof)', () => {
  const payload = {
    summary_version: '1.0',
    export_run_id: 'oci_run_basic',
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
  };
  const validation = validateScriptSummaryShape(payload);
  assert.strictEqual(validation.ok, true);

  const evaluation = evaluateReconciliation(validation.summary!);
  assert.strictEqual(evaluation.ok, true);
  assert.strictEqual(evaluation.reconciliation_status, 'INSUFFICIENT_EVIDENCE');
  assert.strictEqual(evaluation.script_summary_status, 'SCRIPT_SUMMARY_RECEIVED');
  assert.strictEqual(evaluation.export_run_integrity, 'EXPORT_RUN_INTEGRITY_UNVERIFIED');
  assert.ok(evaluation.missing_equations.includes('B'));
  assert.ok(evaluation.missing_equations.includes('C'));
  assert.strictEqual(evaluation.checked_equations.length, 0);
});

test('PR-3D Script Summary: missing export_run_id fails validation', () => {
  const payload = {
    summary_version: '1.0',
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
  };
  const validation = validateScriptSummaryShape(payload);
  assert.strictEqual(validation.ok, false);
});

test('PR-3D Script Summary: Eq B reconciles when claimed_count equals classified totals', () => {
  const payload: ScriptSummaryPayload = {
    summary_version: '1.0',
    export_run_id: 'oci_run_eq_b_ok',
    claimed_count: 8,
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
  };
  const evaluation = evaluateReconciliation(payload);
  // ACK counts are missing, so it's INSUFFICIENT_EVIDENCE, but Eq B is reconciled
  assert.strictEqual(evaluation.ok, true);
  assert.ok(!evaluation.mismatch_reasons?.includes('SCRIPT_CLASSIFICATION_MISMATCH'));
  assert.strictEqual(evaluation.export_run_integrity, 'EXPORT_RUN_INTEGRITY_PARTIAL');
  assert.ok(evaluation.checked_equations.includes('B'));
  assert.ok(evaluation.missing_equations.includes('C'));
});

test('PR-3D Script Summary: Eq B mismatches when totals differ', () => {
  const payload: ScriptSummaryPayload = {
    summary_version: '1.0',
    export_run_id: 'oci_run_eq_b_bad',
    claimed_count: 10,
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
  };
  const evaluation = evaluateReconciliation(payload);
  assert.strictEqual(evaluation.ok, false);
  assert.strictEqual(evaluation.reconciliation_status, 'MISMATCH');
  assert.strictEqual(evaluation.export_run_integrity, 'EXPORT_RUN_INTEGRITY_RED');
  assert.ok(evaluation.mismatch_reasons?.includes('SCRIPT_CLASSIFICATION_MISMATCH'));
  assert.ok(evaluation.checked_equations.includes('B'));
});

test('PR-3D Script Summary: Eq C reconciles when upload_attempted equals ACK totals + ambiguous pending', () => {
  const payload: ScriptSummaryPayload = {
    summary_version: '1.0',
    export_run_id: 'oci_run_eq_c_ack',
    claimed_count: 8,
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
    ack_success_count: 4,
    ack_failed_count: 1,
    provider_ambiguous_pending_count: 0
  };
  const evaluation = evaluateReconciliation(payload);
  assert.strictEqual(evaluation.ok, true);
  assert.strictEqual(evaluation.reconciliation_status, 'RECONCILED');
  assert.strictEqual(evaluation.export_run_integrity, 'EXPORT_RUN_INTEGRITY_PARTIAL');
  assert.ok(!evaluation.mismatch_reasons?.includes('ACK_TOTAL_MISMATCH'));
  assert.ok(evaluation.checked_equations.includes('C'));
  assert.ok(evaluation.checked_equations.includes('B'));
});

test('PR-3D Script Summary: Eq C returns INSUFFICIENT_EVIDENCE when ACK counts are missing', () => {
  const payload: ScriptSummaryPayload = {
    summary_version: '1.0',
    export_run_id: 'oci_run_eq_c_missing_ack',
    claimed_count: 8,
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
    // ack_success_count missing
  };
  const evaluation = evaluateReconciliation(payload);
  assert.strictEqual(evaluation.ok, true);
  assert.strictEqual(evaluation.reconciliation_status, 'INSUFFICIENT_EVIDENCE');
  assert.strictEqual(evaluation.export_run_integrity, 'EXPORT_RUN_INTEGRITY_PARTIAL');
  assert.ok(evaluation.mismatch_reasons?.includes('ACK_COUNTS_MISSING'));
  assert.ok(evaluation.checked_equations.includes('B'));
  assert.ok(evaluation.missing_equations.includes('C'));
});

test('PR-3D Script Summary: release evidence reports EXPORT_RUN_INTEGRITY_UNVERIFIED', () => {
  const payload: ScriptSummaryPayload = {
    summary_version: '1.0',
    export_run_id: 'oci_run_partial',
    claimed_count: 8,
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
    ack_success_count: 4,
    ack_failed_count: 1,
  };
  const evaluation = evaluateReconciliation(payload);
  assert.strictEqual(evaluation.export_run_integrity, 'EXPORT_RUN_INTEGRITY_PARTIAL');
  assert.ok(evaluation.checked_equations.includes('B'));
  assert.ok(evaluation.checked_equations.includes('C'));
});
