import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUEUE_STATUSES } from '@/lib/domain/oci/queue-types';

const ROOT = process.cwd();

test('QUEUE_STATUSES matches offline_conversion_queue CHECK (migration)', () => {
  const migrationPath = join(
    ROOT,
    'supabase',
    'migrations',
    '20260503100000_oci_ssot_blocked_and_reconciliation.sql'
  );
  const src = readFileSync(migrationPath, 'utf8');
  for (const s of QUEUE_STATUSES) {
    assert.ok(src.includes(`'${s}'`), `migration must allow status ${s}`);
  }
});

test('export fetch still restricts queue to QUEUED and RETRY', () => {
  const exportFetch = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts');
  const src = readFileSync(exportFetch, 'utf8');
  assert.ok(src.includes(".in('status', ['QUEUED', 'RETRY'])"), 'export fetch must not pull BLOCKED rows');
});
