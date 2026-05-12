import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  derivePersistStatus,
  evaluatePersistEquations,
  normalizeSummaryForPersist,
} from '@/lib/oci/export-run-summary-equations';
import type { ScriptSummaryPayload } from '@/lib/oci/export-run-reconciliation';
import { buildPayloadRedacted } from '@/lib/oci/export-run-summary-payload-redacted';

const ROOT = process.cwd();

test('PR-9H.7F: normalize clamps negative integers before persist equations', () => {
  const raw: ScriptSummaryPayload = {
    summary_version: '1',
    export_run_id: 'run_neg',
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 5,
    ack_success_count: -3,
    claimed_count: -10,
  };
  const n = normalizeSummaryForPersist(raw);
  assert.strictEqual(n.claimed_count, 0);
  assert.strictEqual(n.ack_success_count, 0);
});

test('PR-9H.7F: payload equation mismatch yields SCRIPT_SUMMARY_MISMATCH', () => {
  const s = normalizeSummaryForPersist({
    summary_version: '1',
    export_run_id: 'run_mismatch',
    fetched_count: 2,
    claimed_count: 2,
    classified_uploadable_count: 1,
    classified_skipped_count: 0,
    classified_failed_count: 0,
    upload_attempted_count: 1,
    upload_success_count: 1,
    upload_failed_count: 0,
    provider_ambiguous_pending_count: 0,
  });
  const eq = evaluatePersistEquations(s);
  assert.ok(eq.mismatch_reasons.includes('EQ_B_CLASSIFICATION_MISMATCH'));
  const st = derivePersistStatus({
    shapeOk: true,
    mismatch_reasons: eq.mismatch_reasons,
    partial_evidence: eq.partial_evidence,
  });
  assert.strictEqual(st, 'SCRIPT_SUMMARY_MISMATCH');
});

test('PR-9H.7F: reconciled when equations hold and fetched present', () => {
  const s = normalizeSummaryForPersist({
    summary_version: '1',
    export_run_id: 'run_ok',
    fetched_count: 8,
    claimed_count: 8,
    classified_uploadable_count: 5,
    classified_skipped_count: 2,
    classified_failed_count: 1,
    upload_attempted_count: 8,
    upload_success_count: 7,
    upload_failed_count: 0,
    provider_ambiguous_pending_count: 1,
    ack_success_count: 3,
    ack_failed_count: 2,
    ack_skipped_count: 3,
    /** PR-9I counters: normalize always materializes these; must satisfy Eq E–H when present as numbers. */
    selected_gclid_count: 8,
    selected_wbraid_count: 0,
    selected_gbraid_count: 0,
    multiple_click_ids_count: 0,
    hashed_phone_attached_count: 0,
    hashed_phone_only_rejected_count: 1,
    missing_click_id_count: 0,
    invalid_time_count: 0,
    other_validation_failed_count: 0,
  });
  const eq = evaluatePersistEquations(s);
  assert.strictEqual(eq.mismatch_reasons.length, 0);
  const st = derivePersistStatus({
    shapeOk: true,
    mismatch_reasons: eq.mismatch_reasons,
    partial_evidence: eq.partial_evidence,
  });
  assert.strictEqual(st, 'SCRIPT_SUMMARY_RECONCILED');
});

test('PR-9H.7F: buildPayloadRedacted omits external_id_hash and sensitive lanes', () => {
  const p = buildPayloadRedacted({
    summary_version: '1',
    export_run_id: 'run_redact',
    classified_uploadable_count: 1,
    classified_skipped_count: 0,
    classified_failed_count: 0,
    upload_attempted_count: 1,
    external_id_hash: 'must-not-persist',
  } as ScriptSummaryPayload);
  assert.strictEqual('external_id_hash' in p, false);
});

test('PR-9H.7F: migration grants oci_export_run_summaries to service_role only', () => {
  const src = readFileSync(
    join(ROOT, 'supabase/migrations/20261227110000_pr9h7f_oci_export_run_summaries.sql'),
    'utf8'
  );
  assert.match(src, /GRANT\s+SELECT,\s*INSERT,\s*UPDATE\s+ON\s+TABLE\s+public\.oci_export_run_summaries\s+TO\s+service_role/i);
  assert.ok(!/\bGRANT\b[^;]*\bTO\s+anon\b/i.test(src));
  assert.ok(!/\bGRANT\b[^;]*\bTO\s+authenticated\b/i.test(src));
});
