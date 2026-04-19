/**
 * Phase 4 guard: VOID_LEDGER_SALT has no insecure fallback.
 *
 * The Merkle chain protecting marketing_signals.current_hash is only as strong
 * as its salt. Prior to 20260419180000 the code accepted a hardcoded
 * 'void_consensus_salt_insecure' string when the env var was unset, silently
 * weakening the ledger. Phase 4 removes that fallback and makes the env var
 * strictly required in production.
 *
 * This test pins three invariants:
 *   1) `getVoidLedgerSalt()` throws when NODE_ENV=production and the env is unset.
 *   2) No runtime file contains the literal 'void_consensus_salt_insecure'.
 *   3) The hash helper routes through `getVoidLedgerSalt()` (no raw `process.env.VOID_LEDGER_SALT` reads).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'coverage',
  'dist',
  'build',
  '.turbo',
  '.vercel',
  'out',
]);

// Docs, migrations, and this test file are allowed to mention the literal.
const ALLOWED_PREFIXES = [
  'docs/',
  'supabase/migrations/',
  'tests/architecture/phase4-void-ledger-salt-required.test.ts',
];

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const out: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    const dot = entry.lastIndexOf('.');
    const ext = dot >= 0 ? entry.slice(dot) : '';
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    out.push(full);
  }
  return out;
}

test('getVoidLedgerSalt throws in production when VOID_LEDGER_SALT is unset', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSalt = process.env.VOID_LEDGER_SALT;
  try {
    delete process.env.VOID_LEDGER_SALT;
    // NODE_ENV is readonly on the NodeJS.ProcessEnv type; cast through unknown.
    (process.env as unknown as Record<string, string>).NODE_ENV = 'production';

    // Force a fresh module load so the internal cache starts empty.
    const modPath = require.resolve('@/lib/oci/marketing-signal-hash');
    delete require.cache[modPath];
    const mod = (await import('@/lib/oci/marketing-signal-hash')) as typeof import('@/lib/oci/marketing-signal-hash');
    mod.resetVoidLedgerSaltCacheForTests();

    assert.throws(
      () => mod.getVoidLedgerSalt(),
      /VOID_LEDGER_SALT is required in production/,
      'must throw fail-fast in production'
    );
  } finally {
    if (prevSalt === undefined) {
      delete process.env.VOID_LEDGER_SALT;
    } else {
      process.env.VOID_LEDGER_SALT = prevSalt;
    }
    (process.env as unknown as Record<string, string>).NODE_ENV = prevNodeEnv ?? 'test';
  }
});

test('getVoidLedgerSalt returns the env value when set', async () => {
  const prevSalt = process.env.VOID_LEDGER_SALT;
  try {
    process.env.VOID_LEDGER_SALT = 'unit_test_salt_value';
    const mod = await import('@/lib/oci/marketing-signal-hash');
    mod.resetVoidLedgerSaltCacheForTests();
    assert.equal(mod.getVoidLedgerSalt(), 'unit_test_salt_value');
  } finally {
    if (prevSalt === undefined) {
      delete process.env.VOID_LEDGER_SALT;
    } else {
      process.env.VOID_LEDGER_SALT = prevSalt;
    }
    const mod = await import('@/lib/oci/marketing-signal-hash');
    mod.resetVoidLedgerSaltCacheForTests();
  }
});

test('no insecure salt literal remains in runtime code', () => {
  const files = walk(ROOT);
  const violations: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (/void_consensus_salt_insecure/.test(src)) {
      violations.push(relative(ROOT, file).replace(/\\/g, '/'));
    }
  }
  assert.equal(
    violations.length,
    0,
    `insecure salt literal still present in:\n${violations.join('\n')}`
  );
});

test('only marketing-signal-hash.ts reads VOID_LEDGER_SALT directly', () => {
  const files = walk(ROOT);
  const offenders: string[] = [];
  // Test files are allowed to flip the env var to exercise salt rotation and
  // fail-fast paths — they do not run in production.
  const allowedPrefixes = ['lib/oci/marketing-signal-hash.ts', 'tests/'];
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (allowedPrefixes.some((p) => rel.startsWith(p) || rel.endsWith(p))) continue;
    const src = readFileSync(file, 'utf8');
    if (/process\.env\.VOID_LEDGER_SALT/.test(src)) {
      offenders.push(rel);
    }
  }
  assert.equal(
    offenders.length,
    0,
    `VOID_LEDGER_SALT must only be read via getVoidLedgerSalt(); direct reads found in:\n${offenders.join('\n')}`
  );
});
