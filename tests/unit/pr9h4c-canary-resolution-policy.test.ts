import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const wrapperPath = join(process.cwd(), 'scripts', 'db', 'oci-canary-live-export.mjs');
const pr9h4cRecoverPath = join(process.cwd(), 'scripts', 'db', 'pr9h4c-recover-claimed-not-uploaded.mjs');
const muratcanScriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptMuratcanAku.js');
const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

test('PR-9H.4C: recovery wrapper targets only hardened PR-9H.4B queue/site pair', () => {
  const src = readFileSync(pr9h4cRecoverPath, 'utf8');
  assert.match(src, /ALLOWED_QUEUE_ID = '0b298a99-673a-4cd1-a2c1-94a3b192e47c'/);
  assert.match(src, /ALLOWED_SITE_ID = '7eb8f5c0-4a96-4a0e-bd89-a463127b26b8'/);
});

test('PR-9H.4C: recovery requires explicit incident approval token', () => {
  const src = readFileSync(pr9h4cRecoverPath, 'utf8');
  assert.match(src, /REQUIRED_APPROVAL = 'I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_CLAIMED_NOT_UPLOADED'/);
});

test('PR-9H.4C: recovery uses row-scoped RPC only (no direct SQL status patch)', () => {
  const src = readFileSync(pr9h4cRecoverPath, 'utf8');
  assert.match(src, /recover_safe_processing_queue_rows_v1/);
  assert.doesNotMatch(src, /\.update\(\s*\{[^}]*status:/i);
});

test('PR-9H.4C: recovery script carries no CANARY_UPLOAD_APPROVAL (upload is out-of-repo / future-gated)', () => {
  const src = readFileSync(pr9h4cRecoverPath, 'utf8');
  assert.doesNotMatch(src, /CANARY_UPLOAD_APPROVAL/);
});

test('PR-9H.4C: live export wrapper documents ACK/out-of-band (no inlined ACK HTTP client)', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.ok(src.includes('/api/oci/ack') && src.includes('out-of-band'));
  assert.doesNotMatch(src, /fetch\([^)]*\/api\/oci\/ack/);
});

test('PR-9H.4C: Muratcan Ads script export client defaults mark unless peek', () => {
  const src = readFileSync(muratcanScriptPath, 'utf8');
  assert.match(src, /var doMark = markAsExported !== false/);
});

test('PR-9H.4C: dossier records recovery decision label and PR-9C separation', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /PR-9H\.4C/i);
  assert.match(src, /PRODUCTION_CANARY_RECOVERED_TO_RETRY/);
  assert.match(src, /CANARY_UPLOAD_PATH_NOT_SAFE/);
  assert.match(src, /CANARY_UPLOAD_APPROVAL=I_APPROVE_SINGLE_PAYLOAD_GOOGLE_UPLOAD/);
  assert.match(src, /PR-9C/);
  assert.match(src, /CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED/);
});

test('PR-9H.4C: recovery script documents explicit non-actions (upload + ACK lanes)', () => {
  const src = readFileSync(pr9h4cRecoverPath, 'utf8');
  assert.match(src, /ACK_FAILED/);
});

test('PR-9H.4C: recovery script forbids deletion and status patch objects', () => {
  const src = readFileSync(pr9h4cRecoverPath, 'utf8');
  assert.doesNotMatch(src, /\.delete\(/);
  assert.doesNotMatch(src, /\.update\(\s*\{[^}]*status:/i);
});

test('PR-9H.4C: PR-9F incident recover script stays locked to PR-9C queue id only', () => {
  const pr9fPath = join(process.cwd(), 'scripts', 'db', 'recover-canary-processing-row.mjs');
  const src = readFileSync(pr9fPath, 'utf8');
  assert.match(src, /6c1537a7-98ca-47eb-8bd9-67c35965cf9d/);
});
