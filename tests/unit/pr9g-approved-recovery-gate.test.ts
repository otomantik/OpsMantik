import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const recoveryScriptPath = join(process.cwd(), 'scripts', 'db', 'recover-canary-processing-row.mjs');
const wrapperPath = join(process.cwd(), 'scripts', 'db', 'oci-canary-live-export.mjs');
const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

test('PR-9G recovery remains exact queue_id only', () => {
  const src = readFileSync(recoveryScriptPath, 'utf8');
  assert.match(src, /REQUIRED_QUEUE_ID = '6c1537a7-98ca-47eb-8bd9-67c35965cf9d'/);
  assert.match(src, /targetQueueId !== REQUIRED_QUEUE_ID/);
});

test('PR-9G recovery requires explicit approval token and target site', () => {
  const src = readFileSync(recoveryScriptPath, 'utf8');
  assert.match(src, /REQUIRED_APPROVAL = 'I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_PROCESS_VIOLATION'/);
  assert.match(src, /REQUIRED_SITE_ID = '7eb8f5c0-4a96-4a0e-bd89-a463127b26b8'/);
  assert.match(src, /INVALID_APPROVAL_TOKEN/);
  assert.match(src, /INVALID_TARGET_SITE_ID/);
});

test('PR-9G recovery does not perform broad recovery or direct queue mutation', () => {
  const src = readFileSync(recoveryScriptPath, 'utf8');
  assert.match(src, /\.rpc\('recover_safe_processing_queue_rows_v1'/);
  assert.doesNotMatch(src, /recover_stuck_offline_conversion_jobs/);
  assert.doesNotMatch(src, /\.update\(\s*\{/);
  assert.doesNotMatch(src, /\.delete\(/);
  assert.doesNotMatch(src, /status:\s*['"]COMPLETED['"]/);
});

test('PR-9G dossier preserves process-violation truth and blocked outcome', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED/);
  assert.match(src, /pr9g_execution_result: `INCIDENT_RECOVERY_BLOCKED`/);
  assert.match(src, /Recovery was not executed because required incident approval metadata was missing\./);
});

test('PR-9G fresh canary gate requires hardened guard', () => {
  const wrapper = readFileSync(wrapperPath, 'utf8');
  const dossier = readFileSync(dossierPath, 'utf8');
  assert.match(wrapper, /CANARY_EXPORT_BLOCKED/);
  assert.match(wrapper, /CANARY_REAPPROVAL_REQUIRED/);
  assert.match(dossier, /decision: `FRESH_CANARY_BLOCKED`/);
  assert.match(dossier, /next canary must run via hardened wrapper/i);
});
