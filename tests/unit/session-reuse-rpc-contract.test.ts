import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260501161000_find_or_reuse_session_v1.sql'
);

test('find_or_reuse_session_v1 enforces advisory lock in transaction', () => {
  const src = readFileSync(MIGRATION, 'utf8');
  assert.ok(src.includes('CREATE OR REPLACE FUNCTION public.find_or_reuse_session_v1('), 'migration must define find_or_reuse_session_v1');
  assert.ok(src.includes('pg_advisory_xact_lock('), 'RPC must acquire transaction-scoped advisory lock');
  assert.ok(src.includes('v_lock_key := coalesce(p_site_id::text, \'\') || \'|\' || coalesce(p_primary_click_id, \'\') || \'|\' || v_action || \'|\' || v_target;'), 'lock key must be stable and exclude timestamp');
});

test('find_or_reuse_session_v1 keeps session-first active-card lifecycle guards', () => {
  const src = readFileSync(MIGRATION, 'utf8');
  assert.ok(src.includes("lower(coalesce(c.status, 'intent')) IN ('intent', 'contacted', 'offered')"), 'reuse candidate lookup must stay in active-card statuses');
  assert.ok(src.includes('active_session_single_card_guard validation'), 'migration must validate active session single-card guard');
  assert.ok(src.includes('intent_stamp canonicalization validation'), 'migration must validate canonical stamp contract');
});

