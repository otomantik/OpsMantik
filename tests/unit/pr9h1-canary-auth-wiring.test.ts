import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const wrapperPath = join(process.cwd(), 'scripts', 'db', 'oci-canary-live-export.mjs');
const previewPath = join(process.cwd(), 'scripts', 'db', 'pr9h-preview.mjs');
const previewLibPath = join(process.cwd(), 'scripts', 'db', 'lib', 'oci-canary-preview-walk.mjs');
const exportAuthPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-auth.ts');
const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

test('PR-9H.1: export auth expects x-api-key header; bearer is optional alternate', () => {
  const src = readFileSync(exportAuthPath, 'utf8');
  assert.match(src, /req\.headers\.get\('x-api-key'\)/);
  assert.match(src, /req\.headers\.get\('authorization'\)/);
  assert.match(src, /if \(!siteIdFromAuth && !apiKey\)/);
});

test('PR-9H.2: wrong x-api-key path is rejected with 401 invalid API key', () => {
  const src = readFileSync(exportAuthPath, 'utf8');
  assert.match(src, /Unauthorized: Invalid API key/);
  assert.match(src, /throw new ExportHttpError\(401/);
});

test('PR-9H.1: wrapper requires CANARY_API_KEY and blocks before request when missing', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /readRequiredEnv\('CANARY_API_KEY'\)/);
  assert.match(src, /MISSING_REQUIRED_ENV/);
});

test('PR-9H.1: preview helper requires CANARY_API_KEY only and fail-closes', () => {
  const src = readFileSync(previewPath, 'utf8');
  assert.match(src, /process\.env\.CANARY_API_KEY/);
  assert.doesNotMatch(src, /OCI_API_KEY/);
  assert.match(src, /CANARY_API_KEY_MISSING/);
});

test('PR-9H.1: wrapper and preview send expected auth header only', () => {
  const wrapper = readFileSync(wrapperPath, 'utf8');
  const preview = readFileSync(previewPath, 'utf8');
  assert.match(wrapper, /'x-api-key': meta\.apiKey/);
  assert.match(preview, /'x-api-key': apiKey/);
  assert.doesNotMatch(wrapper, /authorization['"]\s*:/i);
  assert.doesNotMatch(preview, /authorization['"]\s*:/i);
});

test('PR-9H.1: preview remains markAsExported=false and never true', () => {
  const src = readFileSync(previewPath, 'utf8');
  const lib = readFileSync(previewLibPath, 'utf8');
  assert.match(lib, /markAsExported=false/);
  assert.doesNotMatch(lib, /markAsExported=true/);
  assert.match(src, /runCanaryJournalPreviewWalk/);
});

test('PR-9H.1: wrapper live gate requirements preserved', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /readRequiredEnv\('CHANGE_TICKET'\)/);
  assert.match(src, /readRequiredEnv\('OPERATOR_ID'\)/);
  assert.match(src, /readRequiredEnv\('CANARY_APPROVAL'\)/);
  assert.match(src, /readRequiredEnv\('CANARY_EXPECTED_QUEUE_ID'\)/);
  assert.match(src, /CANARY_MAX_BATCH_SIZE_MUST_BE_1/);
});

test('PR-9H.1: scripts do not introduce queue deletion or manual COMPLETED mutation', () => {
  const wrapper = readFileSync(wrapperPath, 'utf8');
  const preview = readFileSync(previewPath, 'utf8');
  assert.doesNotMatch(wrapper, /\.delete\(/);
  assert.doesNotMatch(preview, /\.delete\(/);
  assert.doesNotMatch(wrapper, /status:\s*['"]COMPLETED['"]/i);
  assert.doesNotMatch(preview, /status:\s*['"]COMPLETED['"]/i);
});

test('PR-9H.1: CANARY_API_KEY is not logged in scripts', () => {
  const wrapper = readFileSync(wrapperPath, 'utf8');
  const preview = readFileSync(previewPath, 'utf8');
  assert.doesNotMatch(wrapper, /console\.(log|error)\([^)]*meta\.apiKey/i);
  assert.doesNotMatch(preview, /console\.(log|error)\([^)]*apiKey/i);
});

test('PR-9H.1: dossier keeps PR-9C invalid and PR-9H auth block truth', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED/);
  assert.match(src, /PRODUCTION_CANARY_BLOCKED/);
  assert.match(src, /CANARY_API_KEY/);
});
