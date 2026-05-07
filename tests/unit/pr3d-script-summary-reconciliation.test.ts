import test from 'node:test';
import assert from 'node:assert';
import { validateScriptSummaryShape, evaluateReconciliation, ScriptSummaryPayload } from '@/lib/oci/export-run-reconciliation';

test('PR-3D Script Summary: validates non-negative integer counts', () => {
  const payload = {
    summary_version: '1.0',
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
    ack_success_count: -1 // invalid
  };
  const result = validateScriptSummaryShape(payload);
  assert.strictEqual(result.ok, false);
  assert.match(result.error || '', /Invalid optional integer field: ack_success_count/);
});

test('PR-3D Script Summary: malformed summary returns SCRIPT_SUMMARY_INVALID', () => {
  const payload = {
    summary_version: '1.0',
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
});

test('PR-3D Script Summary: missing optional export_run_id does not hard fail', () => {
  const payload = {
    summary_version: '1.0',
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
    // no export_run_id
  };
  const validation = validateScriptSummaryShape(payload);
  assert.strictEqual(validation.ok, true);
});

test('PR-3D Script Summary: Eq B reconciles when claimed_count equals classified totals', () => {
  const payload: ScriptSummaryPayload = {
    summary_version: '1.0',
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
});

test('PR-3D Script Summary: Eq B mismatches when totals differ', () => {
  const payload: ScriptSummaryPayload = {
    summary_version: '1.0',
    claimed_count: 10,
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
  };
  const evaluation = evaluateReconciliation(payload);
  assert.strictEqual(evaluation.ok, false);
  assert.strictEqual(evaluation.reconciliation_status, 'MISMATCH');
  assert.ok(evaluation.mismatch_reasons?.includes('SCRIPT_CLASSIFICATION_MISMATCH'));
});

test('PR-3D Script Summary: Eq C reconciles when upload_attempted equals ACK totals + ambiguous pending', () => {
  const payload: ScriptSummaryPayload = {
    summary_version: '1.0',
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
  assert.ok(!evaluation.mismatch_reasons?.includes('ACK_TOTAL_MISMATCH'));
});

test('PR-3D Script Summary: Eq C returns INSUFFICIENT_EVIDENCE when ACK counts are missing', () => {
  const payload: ScriptSummaryPayload = {
    summary_version: '1.0',
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
  assert.ok(evaluation.mismatch_reasons?.includes('ACK_COUNTS_MISSING'));
});

test('PR-3D Script Summary: release evidence reports EXPORT_RUN_INTEGRITY_UNVERIFIED', () => {
  const payload: ScriptSummaryPayload = {
    summary_version: '1.0',
    claimed_count: 8,
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
    ack_success_count: 4,
    ack_failed_count: 1,
  };
  const evaluation = evaluateReconciliation(payload);
  assert.strictEqual(evaluation.export_run_integrity, 'EXPORT_RUN_INTEGRITY_UNVERIFIED');
});
