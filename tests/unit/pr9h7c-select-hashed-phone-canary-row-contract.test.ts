/**
 * PR-9H.7C — Read-only canary selector script contract (no DB).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const scriptPath = join(ROOT, 'scripts', 'db', 'pr9h7c-select-hashed-phone-canary-row.mjs');

test('pr9h7c selector resolves site via resolve-site-identity and never logs secrets', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /resolveSiteIdentity/);
  assert.match(src, /read_only:\s*true/);
  assert.match(src, /Never prints/);
  assert.ok(!src.includes('console.log(g'), 'must not log raw gclid');
  assert.ok(!src.includes('console.log(row.gclid'), 'must not print gclid');
});

test('pr9h7c selector requires gclid and currency alignment for Script v1 canary', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /expectedCurrency/);
  assert.match(src, /EXPECTED_CURRENCY/);
  assert.match(src, /has_gclid/);
  assert.match(src, /VALID_HASH_HEX/);
});

test('pr9h7c currency repair is dry-run by default and guarded on apply', () => {
  const p = join(ROOT, 'scripts', 'db', 'pr9h7c-currency-anomaly-repair.mjs');
  const src = readFileSync(p, 'utf8');
  assert.match(src, /dry_run/);
  assert.match(src, /I_APPROVE_OCI_CURRENCY_REPAIR/);
  assert.match(src, /sweep_unsent_conversions/);
});
