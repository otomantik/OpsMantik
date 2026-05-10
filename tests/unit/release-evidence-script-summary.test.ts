import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveScriptSummaryEvidenceFields } from '../../scripts/release/script-summary-evidence-helpers.mjs';

test('release evidence: missing health row yields SCRIPT_SUMMARY_PERSISTENCE_MISSING', () => {
  const m = deriveScriptSummaryEvidenceFields({});
  assert.strictEqual(m.script_summary_persistence, 'SCRIPT_SUMMARY_PERSISTENCE_MISSING');
  assert.strictEqual(m.script_summary_status, 'SCRIPT_SUMMARY_MISSING');
});

test('release evidence: persistence present + mismatch count surfaces SCRIPT_SUMMARY_MISMATCH', () => {
  const m = deriveScriptSummaryEvidenceFields({
    healthRow: {
      script_summary_persistence: 'SCRIPT_SUMMARY_PERSISTENCE_PRESENT',
      script_summary_mismatch_count: '2',
      reconciled_row_count: '0',
      latest_received_at: '2026-05-10T00:00:00Z',
    },
  });
  assert.strictEqual(m.script_summary_persistence, 'SCRIPT_SUMMARY_PERSISTENCE_PRESENT');
  assert.strictEqual(m.script_summary_status, 'SCRIPT_SUMMARY_MISMATCH');
  assert.strictEqual(m.script_summary_mismatch_count, 2);
});

test('release evidence: target row echoes counts without payload_redacted', () => {
  const m = deriveScriptSummaryEvidenceFields({
    healthRow: {
      script_summary_persistence: 'SCRIPT_SUMMARY_PERSISTENCE_PRESENT',
      script_summary_mismatch_count: '0',
      reconciled_row_count: '1',
    },
    targetRow: {
      status: 'SCRIPT_SUMMARY_RECONCILED',
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
      hashed_phone_csv_canary_active: true,
      mismatch_reasons: [],
    },
  });
  assert.strictEqual(m.oci_evidence_target_found, true);
  assert.strictEqual(m.oci_evidence_target_counts?.claimed_count, 1);
  assert.strictEqual(m.oci_evidence_target_counts?.hashed_phone_csv_canary_active, true);
  assert.strictEqual(m.script_summary_reconciliation, 'SCRIPT_SUMMARY_RECONCILIATION_GREEN');
  assert.strictEqual(m.checked_equations, 'A,B,C,D');
  assert.strictEqual(m.missing_equations, 'NONE');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(m.oci_evidence_target_counts ?? {}, 'payload_redacted'), false);
});
