import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261105050000_unhide_pending_siblings_in_queue.sql'
);

test('queue visibility migration: lite RPC no longer black-holes same-session pending siblings', () => {
  const src = readFileSync(MIGRATION_PATH, 'utf8');
  assert.ok(src.includes('CREATE OR REPLACE FUNCTION public.get_recent_intents_lite_v1'), 'migration must redefine lite queue RPC');
  assert.ok(src.includes("AND (c.status IS NULL OR c.status = 'intent')"), 'pending queue contract stays intact');
  assert.ok(!src.includes("c2.status IN ('junk','cancelled')"), 'same-session junk/cancelled blacklist must be removed');
  assert.ok(src.includes('same-session pending siblings remain visible'), 'migration comment must describe new visibility rule');
});
