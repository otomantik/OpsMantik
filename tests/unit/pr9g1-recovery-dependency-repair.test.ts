import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261226032000_fix_row_scoped_recovery_retry_payload.sql'
);
const rpcHealthPath = join(process.cwd(), 'scripts', 'sql', 'rpc_contract_health.sql');
const evidencePath = join(process.cwd(), 'scripts', 'release', 'collect-gate-evidence.mjs');
const recoveryScriptPath = join(process.cwd(), 'scripts', 'db', 'recover-canary-processing-row.mjs');
const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

test('PR-9G.1 migration rewires row-scoped recovery to canonical worker transition helper', () => {
  const src = readFileSync(migrationPath, 'utf8');
  assert.match(src, /CREATE OR REPLACE FUNCTION public\.recover_safe_processing_queue_rows_v1/i);
  assert.match(src, /append_worker_transition_batch_v2/i);
  assert.doesNotMatch(src, /SELECT\s+public\.append_sweeper_transition_batch/i);
  assert.match(src, /'RETRY'/);
  assert.match(src, /jsonb_build_object\(/);
  assert.match(src, /'next_retry_at'/);
});

test('PR-9G.1 migration preserves recovery counter contract and service-role gate', () => {
  const src = readFileSync(migrationPath, 'utf8');
  for (const token of [
    'requested_count integer',
    'eligible_count integer',
    'recovered_count integer',
    'skipped_count integer',
    'skipped_terminal_count integer',
    'skipped_not_processing_count integer',
    'skipped_not_stale_count integer',
    'skipped_missing_id_count integer',
    "auth.role() IS DISTINCT FROM 'service_role'",
  ]) {
    assert.ok(src.includes(token), `missing token: ${token}`);
  }
});

test('PR-9G.1 evidence contract pins row-scoped recovery helper dependency', () => {
  const rpc = readFileSync(rpcHealthPath, 'utf8');
  const evidence = readFileSync(evidencePath, 'utf8');
  assert.match(rpc, /RECOVERY_DEPENDENCY_DRIFT/);
  assert.match(rpc, /append_worker_transition_batch_v2/);
  assert.match(evidence, /dependency_drift_count/);
  assert.match(evidence, /Row-scoped recovery dependency drift detected/);
});

test('PR-9G.1 keeps incident script approval gates and no broad fallback mutation', () => {
  const src = readFileSync(recoveryScriptPath, 'utf8');
  assert.match(src, /CANARY_INCIDENT_RECOVERY_APPROVAL/);
  assert.match(src, /\.rpc\('recover_safe_processing_queue_rows_v1'/);
  assert.doesNotMatch(src, /recover_stuck_offline_conversion_jobs/);
  assert.doesNotMatch(src, /\.update\(\s*\{/);
  assert.doesNotMatch(src, /\.delete\(/);
  assert.doesNotMatch(src, /status:\s*['"]COMPLETED['"]/i);
});

test('PR-9G.1 does not reclassify PR-9C process violation as success', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED/);
  assert.doesNotMatch(src, /PRODUCTION_CANARY_SUCCESS/);
});
