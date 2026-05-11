import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePersistedSummaryEquations } from '../../scripts/release/script-summary-target-equations.mjs';

test('evaluatePersistedSummaryEquations returns GREEN for canonical canary counts', () => {
  const row = {
    fetched_count: 1,
    claimed_count: 1,
    classified_uploadable_count: 1,
    classified_skipped_count: 0,
    classified_failed_count: 0,
    upload_attempted_count: 1,
    upload_success_count: 1,
    upload_failed_count: 0,
    ack_success_count: 1,
    ack_failed_count: 0,
    ack_skipped_count: 0,
    provider_ambiguous_pending_count: 0,
    status: 'SCRIPT_SUMMARY_RECEIVED',
  };
  const ev = evaluatePersistedSummaryEquations(row);
  assert.equal(ev.script_summary_reconciliation, 'SCRIPT_SUMMARY_RECONCILIATION_GREEN');
  assert.equal(ev.checked_equations, 'A,B,C,D');
  assert.equal(ev.missing_equations, 'NONE');
  assert.deepEqual(ev.mismatch_reasons, []);
});

test('evaluatePersistedSummaryEquations PR-9I bundle Eq E–H green', () => {
  const row = {
    fetched_count: 3,
    claimed_count: 3,
    classified_uploadable_count: 2,
    classified_skipped_count: 0,
    classified_failed_count: 1,
    upload_attempted_count: 2,
    upload_success_count: 2,
    upload_failed_count: 0,
    ack_success_count: 2,
    ack_failed_count: 0,
    ack_skipped_count: 0,
    provider_ambiguous_pending_count: 0,
    selected_gclid_count: 1,
    selected_wbraid_count: 1,
    selected_gbraid_count: 0,
    multiple_click_ids_count: 1,
    hashed_phone_attached_count: 1,
    hashed_phone_only_rejected_count: 1,
    missing_click_id_count: 0,
    invalid_time_count: 0,
    other_validation_failed_count: 0,
    status: 'SCRIPT_SUMMARY_RECEIVED',
  };
  const ev = evaluatePersistedSummaryEquations(row);
  assert.deepEqual(ev.mismatch_reasons, []);
  assert.match(ev.checked_equations, /E/);
  assert.match(ev.checked_equations, /H/);
});

test('evaluatePersistedSummaryEquations detects EQ_B mismatch', () => {
  const row = {
    fetched_count: 1,
    claimed_count: 2,
    classified_uploadable_count: 1,
    classified_skipped_count: 0,
    classified_failed_count: 0,
    upload_attempted_count: 1,
    upload_success_count: 1,
    upload_failed_count: 0,
    ack_success_count: 1,
    ack_failed_count: 0,
    ack_skipped_count: 0,
    provider_ambiguous_pending_count: 0,
  };
  const ev = evaluatePersistedSummaryEquations(row);
  assert.ok(ev.mismatch_reasons.includes('EQ_B_CLASSIFICATION_MISMATCH'));
  assert.equal(ev.script_summary_reconciliation, 'SCRIPT_SUMMARY_RECONCILIATION_MISMATCH');
});
