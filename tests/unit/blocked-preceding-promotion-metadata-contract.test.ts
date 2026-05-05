import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('migration restores apply_snapshot_batch clearing of block_reason and blocked_at on QUEUED promotion', () => {
  const path = join(ROOT, 'supabase', 'migrations', '20261226021000_oci_snapshot_batch_blocked_metadata_and_assert.sql');
  const sql = readFileSync(path, 'utf8');

  assert.ok(
    sql.includes("WHEN p.new_status = 'QUEUED' AND q.status = 'BLOCKED_PRECEDING_SIGNALS'"),
    'snapshot update must explicitly clear blocked metadata when leaving BLOCKED_PRECEDING_SIGNALS for QUEUED'
  );
  assert.ok(
    sql.includes("WHEN 'block_reason' = ANY (p.clear_fields)"),
    'snapshot must honour clear_fields for block_reason'
  );
  assert.ok(
    sql.includes("WHEN 'blocked_at' = ANY (p.clear_fields)"),
    'snapshot must honour clear_fields for blocked_at'
  );
  const idxWhitelist = sql.indexOf('WHERE field_name NOT IN');
  assert.ok(idxWhitelist >= 0, 'snapshot batch must validate clear_fields whitelist');
  const whitelistSlice = sql.slice(idxWhitelist, idxWhitelist + 900);
  assert.ok(
    whitelistSlice.includes("'block_reason'") && whitelistSlice.includes("'blocked_at'"),
    'whitelist must include block_reason and blocked_at'
  );
});

test('assert_latest_ledger_matches_snapshot guards blocked metadata after promotion', () => {
  const path = join(ROOT, 'supabase', 'migrations', '20261226021000_oci_snapshot_batch_blocked_metadata_and_assert.sql');
  const sql = readFileSync(path, 'utf8');

  assert.ok(
    sql.includes("WHEN 'block_reason' = ANY (p.clear_fields) AND q.block_reason IS NOT NULL"),
    'assert must detect ledger/snapshot drift on block_reason'
  );
  assert.ok(
    sql.includes("WHEN 'blocked_at' = ANY (p.clear_fields) AND q.blocked_at IS NOT NULL"),
    'assert must detect ledger/snapshot drift on blocked_at'
  );
  assert.ok(
    sql.includes("WHEN p.new_status = 'QUEUED' AND (q.block_reason IS NOT NULL OR q.blocked_at IS NOT NULL)"),
    'assert must reject QUEUED rows that still carry blocked precursor metadata'
  );
});

test('queue_transition_payload_has_meaningful_patch treats block clear_fields as meaningful', () => {
  const path = join(ROOT, 'supabase', 'migrations', '20261226021000_oci_snapshot_batch_blocked_metadata_and_assert.sql');
  const sql = readFileSync(path, 'utf8');

  const idx = sql.indexOf('CREATE OR REPLACE FUNCTION public.queue_transition_payload_has_meaningful_patch');
  assert.ok(idx >= 0, 'migration must replace queue_transition_payload_has_meaningful_patch');
  const slice = sql.slice(idx, idx + 3500);
  assert.ok(
    slice.includes("'block_reason'") && slice.includes("'blocked_at'"),
    'meaningful_patch must count block_reason/blocked_at clear_fields'
  );
});

test('promote-blocked-queue passes clear_fields for blocked metadata', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'promote-blocked-queue.ts'), 'utf8');
  assert.ok(src.includes("clear_fields: ['block_reason', 'blocked_at']"), 'promotion must request snapshot clear of block columns');
  assert.ok(src.includes("append_worker_transition_batch_v2"), 'promotion must use worker batch v2 RPC');
});

test('export claim path never selects BLOCKED_PRECEDING_SIGNALS rows', () => {
  const exportFetch = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'), 'utf8');
  assert.ok(
    exportFetch.includes(".in('status', ['QUEUED', 'RETRY'])"),
    'export fetch must never include BLOCKED_PRECEDING_SIGNALS rows'
  );
  const claimSrc = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql'),
    'utf8'
  );
  assert.ok(
    claimSrc.includes("q.status IN ('QUEUED', 'RETRY')"),
    'script claim batch must filter QUEUED|RETRY only'
  );
});

test('documented operational exceptions for BLOCKED_PRECEDING_SIGNALS -> QUEUED', () => {
  const manual = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20260503100100_oci_snapshot_and_manual_blocked_clear.sql'),
    'utf8'
  );
  assert.ok(
    manual.includes("append_manual_transition_batch") &&
      manual.includes('BLOCKED_PRECEDING_SIGNALS') &&
      manual.includes("ARRAY['block_reason', 'blocked_at']"),
    'manual reset path append_manual_transition_batch also clears block columns when resetting to QUEUED'
  );
});
