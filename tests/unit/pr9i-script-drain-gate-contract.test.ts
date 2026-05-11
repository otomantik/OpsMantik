import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const exportAuthPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-auth.ts');
const auditWrapperPath = join(process.cwd(), 'scripts', 'db', 'pr9i-universal-script-drain-audit.mjs');
const auditCliPath = join(process.cwd(), 'scripts', 'db', 'pr9i-universal-script-drain-audit-cli.ts');

test('PR-9I: export-auth enforces broad drain approval when allowlist empty', () => {
  const src = readFileSync(exportAuthPath, 'utf8');
  assert.match(src, /SCRIPT_DRAIN_BLOCKED/);
  assert.match(src, /I_APPROVE_SCRIPT_DRAIN/);
  assert.match(src, /x-opsmantik-drain-approval/);
  assert.match(src, /OPSMANTIK_DRAIN_APPROVAL/);
  assert.match(src, /x-opsmantik-drain-include-braids/);
  assert.match(src, /broadMutatingExport/);
});

test('PR-9I: audit wrapper delegates to tsx CLI', () => {
  const src = readFileSync(auditWrapperPath, 'utf8');
  assert.match(src, /pr9i-universal-script-drain-audit-cli\.ts/);
  assert.match(src, /tsx/);
});

test('PR-9I: audit CLI never logs raw identifiers (sanitized outputs only)', () => {
  const src = readFileSync(auditCliPath, 'utf8');
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*gclid/i);
  assert.match(src, /uuidSnippet/);
});
