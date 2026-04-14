/**
 * Phase 12: Workers ingest uses atomic compensation RPC.
 * When processSyncEvent fails, decrement + delete idempotency must run in one transaction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKERS_INGEST = join(process.cwd(), 'lib', 'ingest', 'worker-kernel.ts');
const MIGRATION = join(process.cwd(), 'supabase', 'migrations', '20261112000000_decrement_and_delete_idempotency_atomic.sql');

test('Phase 12: workers ingest uses atomic compensation RPC', () => {
  const src = readFileSync(WORKERS_INGEST, 'utf8');
  assert.ok(src.includes('decrement_and_delete_idempotency'), 'worker must call atomic compensation RPC');
  assert.ok(!src.includes('decrement_usage_compensation'), 'worker must not use legacy separate decrement');
  assert.ok(!src.includes('deleteIdempotencyKeyForCompensation'), 'worker must not use separate delete');
});

test('Phase 12: atomic compensation migration exists', () => {
  const src = readFileSync(MIGRATION, 'utf8');
  assert.ok(src.includes('decrement_and_delete_idempotency'), 'migration must define atomic RPC');
  assert.ok(src.includes('usage_counters') && src.includes('ingest_idempotency'), 'RPC must touch both tables');
});
