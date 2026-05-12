import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const exportAuthPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-auth.ts');
const exportRoutePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
const exportFetchPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts');
const markProcessingPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts');
const muratcanScriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptMuratcanAku.js');
const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

test('PR-9H.4D: canary allowlist must contain exactly one id', () => {
  const src = readFileSync(exportAuthPath, 'utf8');
  assert.match(src, /allowlist must contain exactly one queue id/i);
});

test('PR-9H.4D: allowlist id must equal expected queue id', () => {
  const src = readFileSync(exportAuthPath, 'utf8');
  assert.match(src, /allowlist id must equal expected queue id/i);
});

test('PR-9H.4D: canary live claim blocks without allowlist metadata', () => {
  const src = readFileSync(exportAuthPath, 'utf8');
  assert.match(src, /x-opsmantik-allowlist-ids/);
  assert.match(src, /CANARY_EXPORT_BLOCKED/);
});

test('PR-9H.4F.1: export-auth merges allowlist_ids query alias + tracks query/header seen', () => {
  const src = readFileSync(exportAuthPath, 'utf8');
  assert.match(src, /allowlist_ids/);
  assert.match(src, /canaryAllowlistQuerySeen/);
  assert.match(src, /canaryAllowlistHeaderSeen/);
});

test('PR-9H.4F.1: export route emits allowlist_contract preview diagnostics + no-store cache', () => {
  const src = readFileSync(exportRoutePath, 'utf8');
  assert.match(src, /allowlist_contract/);
  assert.match(src, /applied_to_fetch/);
  assert.match(src, /no-store/);
});

test('PR-9H.4D: export fetch is server-side filtered by allowlist in canary mode', () => {
  const src = readFileSync(exportFetchPath, 'utf8');
  assert.match(src, /ctx\.canaryMode && ctx\.canaryAllowlistIds\.length > 0/);
  assert.match(src, /p_canary_queue_ids/);
  assert.match(src, /canaryAllowlistIds/);
});

test('PR-9H.4D: claim path enforces allowlist/expected id parity', () => {
  const src = readFileSync(markProcessingPath, 'utf8');
  assert.match(src, /ctx\.canaryAllowlistIds\.length !== 1/);
  assert.match(src, /ctx\.canaryAllowlistIds\[0\] !== idsToMarkProcessing\[0\]/);
});

test('PR-9H.4D: Muratcan sync requires explicit upload approval token', () => {
  const src = readFileSync(muratcanScriptPath, 'utf8');
  assert.match(src, /CANARY_UPLOAD_APPROVAL/);
  assert.match(src, /I_APPROVE_SINGLE_PAYLOAD_GOOGLE_UPLOAD/);
  assert.match(src, /CANARY_UPLOAD_APPROVAL_MISSING/);
});

test('PR-9H.4D: Muratcan script sends allowlist + expected queue metadata to export route', () => {
  const src = readFileSync(muratcanScriptPath, 'utf8');
  assert.match(src, /allowlistIds=/);
  assert.match(src, /allowlist_ids=/);
  assert.match(src, /x-opsmantik-allowlist-ids/);
  assert.match(src, /x-opsmantik-canary-expected-queue-id/);
});

test('PR-9H.4D: Muratcan sync sends export-run-summary with counts', () => {
  const src = readFileSync(muratcanScriptPath, 'utf8');
  assert.match(src, /sendSummary/);
  assert.match(src, /upload_attempted_count/);
  assert.match(src, /ack_success_count/);
  assert.match(src, /ack_failed_count/);
});

test('PR-9H.4D: no queue deletion or manual status patch in script path', () => {
  const src = readFileSync(muratcanScriptPath, 'utf8');
  assert.doesNotMatch(src, /\.delete\(/);
  assert.doesNotMatch(src, /\.update\(\s*\{[^}]*status:/i);
});

test('PR-9H.4D: dossier preserves PR-9C invalid state and no success claim', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /PR-9C/);
  assert.match(src, /CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED/);
  assert.doesNotMatch(src, /PRODUCTION_CANARY_SUCCESS/);
});
