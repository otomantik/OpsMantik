import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');
const runbookPath = join(process.cwd(), 'docs', 'runbooks', 'OCI_HARDENING_OPERATIONS.md');
const wrapperPath = join(process.cwd(), 'scripts', 'db', 'oci-canary-live-export.mjs');
const recoveryPath = join(process.cwd(), 'scripts', 'db', 'pr9h4c-recover-claimed-not-uploaded.mjs');

test('PR-9H.4F: runbook forbids localhost for production canary live claims', () => {
  const src = readFileSync(runbookPath, 'utf8');
  assert.match(src, /PR-9H\.4F/i);
  assert.match(src, /localhost/i);
  assert.match(src, /LOCALHOST_LIVE_CANARY_FORBIDDEN|fail closed/i);
});

test('PR-9H.4F: live wrapper rejects localhost APP_BASE_URL for --live', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /LOCALHOST_LIVE_CANARY_FORBIDDEN/);
  assert.match(src, /PR9H4F_HOSTED_APP_BASE_URL_ONLY|PR9H4F/);
});

test('PR-9H.4F: claimed-not-uploaded recovery requires exact approval token', () => {
  const src = readFileSync(recoveryPath, 'utf8');
  assert.match(src, /I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_CLAIMED_NOT_UPLOADED/);
  assert.match(src, /INVALID_APPROVAL_TOKEN/);
});

test('PR-9H.4F: recovery wrapper is pinned to exact Muratcan queue id', () => {
  const src = readFileSync(recoveryPath, 'utf8');
  assert.match(src, /0b298a99-673a-4cd1-a2c1-94a3b192e47c/);
  assert.match(src, /ALLOWED_QUEUE_ID/);
  assert.match(src, /INVALID_TARGET_QUEUE_ID/);
});

test('PR-9H.4F: dossier states hosted allowlisted dry-run must pass before live upload', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /PR-9H\.4F/i);
  assert.match(src, /HOSTED_ALLOWLIST_DRY_RUN_READY|hosted.*dry-run|PR-9H\.4G/i);
});

test('PR-9H.4F: live export wrapper blocks PREVIEW_UNEXPECTED_SINGLETON_ROW at gate', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /PREVIEW_UNEXPECTED_SINGLETON_ROW/);
});

test('PR-9H.4F: recovery script must not delete rows or set COMPLETED', () => {
  const src = readFileSync(recoveryPath, 'utf8');
  assert.doesNotMatch(src, /\.delete\s*\(/);
  assert.doesNotMatch(src, /\.update\s*\(\s*\{[^}]*status:\s*['"]COMPLETED['"]/);
});

test('PR-9H.4F: dossier retains PR-9C invalid separation', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /PR-9C.*invalid|invalid.*PR-9C/i);
});

test('PR-9H.4F-VERIFY: dossier records post-deploy hosted dry-run verification block', () => {
  const md = readFileSync(dossierPath, 'utf8');
  assert.match(md, /PR-9H\.4F-VERIFY/i);
  assert.match(md, /HOSTED_ALLOWLIST_(DRY_RUN_READY|PARITY_FAILED)/i);
});

test('PR-9H.4F.1: dossier records runtime parity diagnosis + cache/allowlist fix', () => {
  const md = readFileSync(dossierPath, 'utf8');
  assert.match(md, /PR-9H\.4F\.1/i);
  assert.match(md, /allowlist_contract|applied_to_fetch/i);
});

test('PR-9H.4F: dossier documents no live export / no upload / no ACK in this PR scope', () => {
  const md = readFileSync(dossierPath, 'utf8');
  const idx = md.indexOf('## PR-9H.4F');
  assert.ok(idx >= 0, 'PR-9H.4F section missing');
  const tail = md.slice(idx, idx + 8000);
  const hasNoLive =
    /no live export|no `markAsExported=true`|No live export|no Google upload|no ACK occurred/i.test(tail);
  assert.ok(hasNoLive, 'PR-9H.4F section should state non-goals');
});
