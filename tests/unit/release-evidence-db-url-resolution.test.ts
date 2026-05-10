import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  isLikelyPlaceholderValue,
  resolveTargetDbConnectionString,
} from '../../scripts/release/resolve-target-db-url.mjs';

const ROOT = process.cwd();

test('resolveTargetDbConnectionString prefers pooler URL over direct DATABASE_URL', () => {
  const env = {
    SUPABASE_DB_POOLER_URL: 'postgresql://aws-0-eu.pooler.supabase.com:6543/postgres',
    DATABASE_URL: 'postgresql://db.abcdefghij.supabase.co:5432/postgres',
  };
  assert.strictEqual(resolveTargetDbConnectionString(env), env.SUPABASE_DB_POOLER_URL);
});

test('resolveTargetDbConnectionString skips placeholder pooler and falls through', () => {
  const env = {
    SUPABASE_DB_POOLER_URL: 'postgresql://<redacted>',
    DATABASE_URL: 'postgresql://db.wxyz.supabase.co:5432/postgres',
  };
  assert.strictEqual(resolveTargetDbConnectionString(env), env.DATABASE_URL);
});

test('collect-gate-evidence: strict_mode reflects TARGET_DB_EVIDENCE_STRICT (not silently dropped)', () => {
  const src = readFileSync(join(ROOT, 'scripts/release/collect-gate-evidence.mjs'), 'utf8');
  assert.ok(src.includes("process.env.TARGET_DB_EVIDENCE_STRICT === '1'"));
  assert.ok(src.includes('strict_mode: evidenceStrict'));
  assert.ok(src.includes('const evidenceStrict = isStrict || targetDbStrict'));
});

test('collect-gate-evidence: strict targeted summary missing adds SCRIPT_SUMMARY_TARGET_MISSING', () => {
  const src = readFileSync(join(ROOT, 'scripts/release/collect-gate-evidence.mjs'), 'utf8');
  assert.ok(src.includes('REASON_CODES.SCRIPT_SUMMARY_TARGET_MISSING'));
  assert.ok(src.includes('OCI_EVIDENCE_EXPORT_RUN_ID'));
});

test('isLikelyPlaceholderValue detects angle-bracket placeholders', () => {
  assert.strictEqual(isLikelyPlaceholderValue('postgresql://<host>:5432/db'), true);
  assert.strictEqual(isLikelyPlaceholderValue('postgresql://aws.pooler.supabase.com/db'), false);
});
