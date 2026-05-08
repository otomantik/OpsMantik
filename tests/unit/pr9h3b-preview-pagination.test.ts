import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const previewPath = join(process.cwd(), 'scripts', 'db', 'pr9h-preview.mjs');
const previewLibPath = join(process.cwd(), 'scripts', 'db', 'lib', 'oci-canary-preview-walk.mjs');

test('PR-9H.3B: preview helper uses CANARY_API_KEY only', () => {
  const src = readFileSync(previewPath, 'utf8');
  assert.match(src, /process\.env\.CANARY_API_KEY/);
  assert.doesNotMatch(src, /OCI_API_KEY/);
});

test('PR-9H.3B: preview helper never uses markAsExported=true', () => {
  const src = readFileSync(previewPath, 'utf8');
  const lib = readFileSync(previewLibPath, 'utf8');
  assert.match(src + lib, /markAsExported=false/);
  assert.doesNotMatch(lib, /markAsExported=true/);
});

test('PR-9H.3B: preview helper reads conversion from conversionName camelCase contract', () => {
  const lib = readFileSync(previewLibPath, 'utf8');
  assert.match(lib, /conversionName/);
});

test('PR-9H.3B: preview helper follows bounded cursor pagination', () => {
  const lib = readFileSync(previewLibPath, 'utf8');
  assert.match(lib, /maxPages/);
  assert.match(lib, /PR9H_PREVIEW_MAX_PAGES|CANARY_PREVIEW_MAX_PAGES/);
  assert.match(lib, /for \(let page = 1; page <= maxPages/);
  assert.match(lib, /&cursor=/);
});

test('PR-9H.3B: preview helper caps max pages upper bound', () => {
  const lib = readFileSync(previewLibPath, 'utf8');
  assert.match(lib, /Math\.min\(\s*Math\.floor\(\s*rawMaxPages\s*\)\s*,\s*60\s*\)/);
});

test('PR-9H.3B: preview helper preserves expected-queue header when CANARY_EXPECTED_QUEUE_ID set', () => {
  const src = readFileSync(previewPath, 'utf8');
  assert.match(src, /x-opsmantik-canary-expected-queue-id/);
});

test('PR-9H.3B: preview helper avoids queue deletion and manual COMPLETED', () => {
  const src = readFileSync(previewPath, 'utf8');
  const lib = readFileSync(previewLibPath, 'utf8');
  assert.doesNotMatch(src + lib, /\.delete\(/);
  assert.doesNotMatch(src + lib, /status:\s*['"]COMPLETED['"]/i);
});

test('PR-9H.3B: preview helper documents read-only mandate', () => {
  const src = readFileSync(previewPath, 'utf8');
  assert.match(src, /markAsExported=false only/);
});
