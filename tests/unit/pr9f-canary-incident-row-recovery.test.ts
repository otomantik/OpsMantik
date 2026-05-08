import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const scriptPath = join(process.cwd(), 'scripts', 'db', 'recover-canary-processing-row.mjs');
const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');
const canaryWrapperPath = join(process.cwd(), 'scripts', 'db', 'oci-canary-live-export.mjs');

test('PR-9F recovery script requires INCIDENT_TICKET', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /getRequiredEnv\('INCIDENT_TICKET'\)/);
});

test('PR-9F recovery script requires INCIDENT_OWNER', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /getRequiredEnv\('INCIDENT_OWNER'\)/);
});

test('PR-9F recovery script requires OPERATOR_ID', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /getRequiredEnv\('OPERATOR_ID'\)/);
});

test('PR-9F recovery script requires exact target queue id', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /REQUIRED_QUEUE_ID = '6c1537a7-98ca-47eb-8bd9-67c35965cf9d'/);
  assert.match(src, /INVALID_TARGET_QUEUE_ID/);
});

test('PR-9F recovery script requires explicit approval token', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /REQUIRED_APPROVAL = 'I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_PROCESS_VIOLATION'/);
  assert.match(src, /INVALID_APPROVAL_TOKEN/);
});

test('PR-9F recovery script calls only recover_safe_processing_queue_rows_v1', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /\.rpc\('recover_safe_processing_queue_rows_v1'/);
  assert.doesNotMatch(src, /recover_stuck_offline_conversion_jobs/);
});

test('PR-9F recovery script has no direct status update', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.doesNotMatch(src, /\.update\(\s*\{/);
});

test('PR-9F recovery script does not delete queue rows', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.doesNotMatch(src, /\.delete\(/);
});

test('PR-9F recovery script does not mark COMPLETED', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.doesNotMatch(src, /status:\s*['"]COMPLETED['"]/);
});

test('PR-9F recovery script marks partial counter mismatch as review required', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /INCIDENT_RECOVERY_PARTIAL_REVIEW_REQUIRED/);
  assert.match(src, /requested === 1 && eligible === 1 && recovered === 1 && skipped === 0/);
});

test('PR-9F dossier does not reclassify PR-9C as success', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED/);
  assert.doesNotMatch(src, /PRODUCTION_CANARY_SUCCESS/);
});

test('PR-9F requires fresh canary under hardened guard', () => {
  const src = readFileSync(canaryWrapperPath, 'utf8');
  assert.match(src, /CANARY_REAPPROVAL_REQUIRED/);
  assert.match(src, /CANARY_EXPORT_BLOCKED/);
});
