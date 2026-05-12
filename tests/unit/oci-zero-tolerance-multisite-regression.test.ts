import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

test('PR-9J migrations encode recovery, snapshot, FSM, and dedup hardening', () => {
  const m1 = read('supabase/migrations/20261228121000_pr9j1_fix_recover_stuck_retry_payload.sql');
  assert.match(m1, /'provider_error_category', 'TRANSIENT'/);
  assert.match(m1, /'next_retry_at', v_next_retry_at/);
  assert.match(m1, /'claimed_at'/);

  const m2 = read('supabase/migrations/20261228122000_pr9j2_snapshot_status_priority.sql');
  assert.match(m2, /oci_status_snapshot_priority/);
  assert.match(m2, /WHEN 'FAILED' THEN 5/);
  assert.match(m2, /WHEN 'PROCESSING' THEN 8/);

  const m3 = read('supabase/migrations/20261228123000_pr9j3_tighten_oci_status_fsm.sql');
  assert.match(m3, /OLD\.status = 'FAILED'/);
  assert.match(m3, /'DEAD_LETTER_QUARANTINE'/);

  const m4 = read('supabase/migrations/20261228125000_pr9j4b_terminal_success_external_id_unique.sql');
  assert.match(m4, /idx_offline_conversion_queue_terminal_success_dedup/);
  assert.match(m4, /COMPLETED_UNVERIFIED/);
});

test('script ACK helpers propagate export_run_id in legacy site scripts', () => {
  for (const path of [
    'scripts/google-ads-oci/GoogleAdsScriptKocOtoKurtarma.js',
    'scripts/google-ads-oci/GoogleAdsScriptTecrubeliBakici.js',
    'scripts/google-ads-oci/GoogleAdsScriptMuratcanAku.js',
    'scripts/google-ads-oci/GoogleAdsScript.js',
  ]) {
    const source = read(path);
    assert.match(source, /export_run_id/);
    assert.match(source, /exportRunId/);
  }
});

test('app-side belt-and-suspenders guards are present', () => {
  const exportMark = read('app/api/oci/google-ads-export/export-mark-processing.ts');
  assert.match(exportMark, /finalizeAt = new Date\(new Date\(now\)\.getTime\(\) \+ 1\)/);

  const processSingle = read('lib/oci/process-single-oci-export.ts');
  assert.match(processSingle, /claimNowMs \+ 1/);

  const enqueue = read('lib/oci/enqueue-intent-conversion-journal-row.ts');
  assert.match(enqueue, /OCI_ENQUEUE_DEDUP_HISTORICAL_TERMINAL_SUCCESS/);
});
