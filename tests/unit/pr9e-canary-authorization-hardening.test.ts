import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const canaryScriptPath = join(process.cwd(), 'scripts', 'db', 'oci-canary-live-export.mjs');
const exportAuthPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-auth.ts');
const markProcessingPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts');
const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

test('PR-9E: canary live export requires CHANGE_TICKET', () => {
  const src = readFileSync(canaryScriptPath, 'utf8');
  assert.match(src, /readRequiredEnv\('CHANGE_TICKET'\)/);
});

test('PR-9E: canary live export requires OPERATOR_ID', () => {
  const src = readFileSync(canaryScriptPath, 'utf8');
  assert.match(src, /readRequiredEnv\('OPERATOR_ID'\)/);
});

test('PR-9E: canary live export requires CANARY_APPROVAL exact token', () => {
  const src = readFileSync(canaryScriptPath, 'utf8');
  assert.match(src, /REQUIRED_APPROVAL = 'I_APPROVE_PRODUCTION_CANARY'/);
  assert.match(src, /INVALID_CANARY_APPROVAL/);
});

test('PR-9E: canary live export requires CANARY_EXPECTED_QUEUE_ID', () => {
  const src = readFileSync(canaryScriptPath, 'utf8');
  assert.match(src, /readRequiredEnv\('CANARY_EXPECTED_QUEUE_ID'\)/);
  assert.match(src, /PREVIEW_EXPECTED_QUEUE_MISMATCH/);
});

test('PR-9E: stuck_processing increase requires explicit canary reapproval', () => {
  const src = readFileSync(canaryScriptPath, 'utf8');
  assert.match(src, /REQUIRED_REAPPROVAL = 'I_REAPPROVE_WITH_STUCK_PROCESSING_INCREASE'/);
  assert.match(src, /CANARY_REAPPROVAL_REQUIRED/);
});

test('PR-9E: missing reapproval blocks before markAsExported=true', () => {
  const src = readFileSync(canaryScriptPath, 'utf8');
  const reapprovalCheck = src.indexOf('CANARY_REAPPROVAL_REQUIRED');
  const liveCall = src.indexOf('const liveUrlBase');
  assert.ok(reapprovalCheck >= 0 && liveCall >= 0 && reapprovalCheck < liveCall);
});

test('PR-9E: canary cannot claim broad batch', () => {
  const src = readFileSync(markProcessingPath, 'utf8');
  assert.match(src, /if \(ctx\.canaryMode\)/);
  assert.match(src, /idsToMarkProcessing\.length !== 1/);
  assert.match(src, /CANARY_EXPORT_BLOCKED/);
});

test('PR-9E: canary max_batch_size must be 1', () => {
  const src = readFileSync(canaryScriptPath, 'utf8');
  assert.match(src, /CANARY_MAX_BATCH_SIZE_MUST_BE_1/);
  const authSrc = readFileSync(exportAuthPath, 'utf8');
  assert.match(authSrc, /canary max batch size must be 1/i);
});

test('PR-9E: dossier cannot claim success while queue row remains PROCESSING', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /`PROCESSING`/);
  assert.doesNotMatch(src, /PRODUCTION_CANARY_SUCCESS/);
});

test('PR-9E: dossier includes process violation decision', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED/);
});

test('PR-9E: canary hardening introduces no queue deletion behavior', () => {
  const src = readFileSync(canaryScriptPath, 'utf8');
  assert.doesNotMatch(src, /\bdelete\b/i);
  assert.doesNotMatch(src, /\bqueue row deletion\b/i);
});

test('PR-9E: canary hardening introduces no manual COMPLETED mutation', () => {
  const src = readFileSync(canaryScriptPath, 'utf8');
  assert.doesNotMatch(src, /COMPLETED/);
  assert.doesNotMatch(src, /update\(\{[^}]*status:\s*'COMPLETED'/i);
});
