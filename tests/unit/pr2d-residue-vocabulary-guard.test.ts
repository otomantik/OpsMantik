import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('PR-2D: Active docs state offline_conversion_queue is the only runtime Google upload journal', () => {
  const content = readFileSync(join(ROOT, 'docs', 'architecture', 'EXPORT_CLOSURE.md'), 'utf8');
  assert.ok(content.includes('only runtime Google upload journal'), 'Must contain exact phrase for Google upload journal');
});

test('PR-2D: export-fetch does not reference marketing_signals', () => {
  const content = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'), 'utf8');
  assert.ok(!content.includes("from('marketing_signals')"), 'export-fetch must never query marketing_signals');
  assert.ok(
    content.includes('fetch_oci_google_ads_export_jit_v1') && content.includes('parseJitExportRpcRowsStrict'),
    'export-fetch must delegate journal read to JIT RPC + strict Zod parse'
  );
});

test('PR-2D: release evidence does not label marketing_signals pending as Google upload backlog', () => {
  const content = readFileSync(join(ROOT, 'scripts', 'release', 'evidence-contracts.mjs'), 'utf8');
  assert.ok(!content.includes('marketing_signals is Google upload backlog'), 'Must not mislabel marketing_signals');
  assert.ok(content.includes('legacy/audit pressure'), 'Must properly classify marketing_signals pending count');
});

test('PR-2D: script_backlog_health labels marketing_signals as legacy/audit pressure', () => {
  const content = readFileSync(join(ROOT, 'scripts', 'sql', 'script_backlog_health.sql'), 'utf8');
  assert.ok(content.includes('legacy/audit observability'), 'Must classify pending signals as legacy/audit');
  assert.ok(content.includes('ACTIVE_RUNTIME_RESIDUE'), 'Must classify pending signals as residue');
  assert.ok(content.includes('must not be interpreted as Google upload backlog'), 'Must warn against treating signals as upload backlog');
});

test('PR-2D: runtime marketing_signals write modules removed', () => {
  assert.ok(!existsSync(join(ROOT, 'lib', 'domain', 'mizan-mantik', 'upsert-marketing-signal.ts')));
  assert.ok(!existsSync(join(ROOT, 'lib', 'domain', 'mizan-mantik', 'insert-marketing-signal.ts')));
  assert.ok(!existsSync(join(ROOT, 'lib', 'oci', 'upsert-marketing-signal.ts')));
});
