import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RETIRED_AUDIT_TABLE, RETIRED_FROM_CLAUSE } from '../helpers/retired-oci-vocabulary';

const ROOT = process.cwd();

test('PR-2D: Active docs state offline_conversion_queue is the only runtime Google upload journal', () => {
  const content = readFileSync(join(ROOT, 'docs', 'architecture', 'EXPORT_CLOSURE.md'), 'utf8');
  assert.ok(content.includes('only runtime Google upload journal'), 'Must contain exact phrase for Google upload journal');
});

test('PR-2D: export-fetch is queue-only', () => {
  const content = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'), 'utf8');
  assert.ok(!content.includes(RETIRED_FROM_CLAUSE), 'export-fetch must not query retired audit table');
  assert.ok(
    content.includes('fetch_oci_google_ads_export_jit_v1') && content.includes('parseJitExportRpcRowsStrict'),
    'export-fetch must delegate journal read to JIT RPC + strict Zod parse'
  );
});

test('PR-2D: release evidence backlog contract is queue-only', () => {
  const content = readFileSync(join(ROOT, 'scripts', 'release', 'evidence-contracts.mjs'), 'utf8');
  assert.ok(content.includes('offline_queue_active_count'), 'Backlog contract must use queue columns');
  assert.ok(!content.includes('retired_pending_count'), 'Must not reference retired table columns');
});

test('PR-2D: script_backlog_health is queue-only', () => {
  const content = readFileSync(join(ROOT, 'scripts', 'sql', 'script_backlog_health.sql'), 'utf8');
  assert.ok(content.includes('offline_conversion_queue'), 'Must read queue journal');
  assert.ok(!content.includes(RETIRED_AUDIT_TABLE), 'Must not reference retired table');
});

test('PR-2D: queue enqueue SSOT module present', () => {
  assert.ok(existsSync(join(ROOT, 'lib', 'oci', 'ensure-oci-queue-enqueue.ts')));
});
