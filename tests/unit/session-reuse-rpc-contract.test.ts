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
const BURST_MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260503150000_find_or_reuse_session_burst_coalesce.sql'
);
const BURST_DEDUPE_CLEANUP_MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261118120000_burst_cross_session_dedupe_cleanup_v1.sql'
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

test('find_or_reuse_session_burst_coalesce adds fingerprint/IP burst paths before candidate fallback', () => {
  const src = readFileSync(BURST_MIGRATION, 'utf8');
  assert.ok(src.includes('reused_recent_fingerprint_burst'), 'must define fingerprint burst reason');
  assert.ok(src.includes('reused_recent_ip_entry_burst'), 'must define ip+entry burst reason');
  assert.ok(src.includes('fallback_candidate_session'), 'candidate fallback must remain');
  const fpIdx = src.indexOf('reused_recent_fingerprint_burst');
  const candIdx = src.indexOf('fallback_candidate_session');
  assert.ok(fpIdx > 0 && candIdx > fpIdx, 'burst reuse must run before candidate_session fallback');
});

test('burst_cross_session_dedupe_cleanup migration archives paired burst losers', () => {
  const src = readFileSync(BURST_DEDUPE_CLEANUP_MIGRATION, 'utf8');
  assert.ok(src.includes('burst_cross_session_dedupe_v1'));
  assert.ok(src.includes('superseded_burst_cross_session_dedupe_v1'));
  assert.ok(src.includes('active_session_single_card_guard validation failed'));
});

