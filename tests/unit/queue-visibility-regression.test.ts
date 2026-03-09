import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261106210000_fail_closed_junk_queue_visibility.sql'
);

test('queue visibility migration: lite RPC fail-closes entire session after junk/cancel', () => {
  const src = readFileSync(MIGRATION_PATH, 'utf8');
  assert.ok(src.includes('CREATE OR REPLACE FUNCTION public.get_recent_intents_lite_v1'), 'migration must redefine lite queue RPC');
  assert.ok(src.includes("AND (c.status IS NULL OR c.status = 'intent')"), 'pending queue contract stays intact');
  assert.ok(src.includes("c2.status IN ('junk','cancelled')"), 'same-session junk/cancelled blacklist must be enforced');
  assert.ok(src.includes('Fail-closed queue visibility'), 'migration comment must describe fail-closed queue behavior');
});

test('queue client fails closed instead of silently falling back to legacy visibility rpc', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'hooks', 'use-queue-controller.ts'), 'utf8');
  assert.ok(src.includes('Queue visibility contract missing: get_recent_intents_lite_v1 is required'), 'client must refuse legacy queue fallback when fail-closed RPC is missing');
  assert.ok(!src.includes("const v1 = await supabase.rpc('get_recent_intents_v1'"), 'legacy queue fallback must be removed from client path');
});
