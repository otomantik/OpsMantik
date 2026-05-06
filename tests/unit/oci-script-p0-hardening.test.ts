import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildOrphanWorkset,
  normalizeSweepSkippedReason,
} from '@/lib/oci/sweep-unsent-conversions-core';
import { isMissingRebuildProjectionRpc } from '@/lib/domain/funnel-kernel/projection-updater';

const ROOT = process.cwd();

test('P0 sweeper discovers won + sealed and excludes already queued', () => {
  const queued = new Set<string>(['call-2']);
  const { orphans, skipped, discoveredWon, discoveredSealed } = buildOrphanWorkset(
    [
      { id: 'call-1', site_id: 'site-1', status: 'won', oci_status: null, confirmed_at: '2026-01-01T00:00:00Z' },
      { id: 'call-2', site_id: 'site-1', status: null, oci_status: 'sealed', confirmed_at: '2026-01-01T00:00:00Z' },
      { id: null, site_id: 'site-1', status: 'won', oci_status: null, confirmed_at: '2026-01-01T00:00:00Z' },
    ],
    queued
  );

  assert.equal(discoveredWon, 2);
  assert.equal(discoveredSealed, 1);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0]?.id, 'call-1');
  assert.equal(skipped.already_queued, 1);
  assert.equal(skipped.missing_call_id, 1);
});

test('P0 sweeper reason mapping is deterministic', () => {
  assert.equal(normalizeSweepSkippedReason('no_click_id'), 'missing_click_id');
  assert.equal(normalizeSweepSkippedReason('marketing_consent_required'), 'consent_missing');
  assert.equal(normalizeSweepSkippedReason('duplicate'), 'already_queued');
  assert.equal(normalizeSweepSkippedReason('duplicate_session'), 'already_queued');
  assert.equal(normalizeSweepSkippedReason('not_export_eligible'), 'not_export_eligible');
  assert.equal(normalizeSweepSkippedReason('error'), 'enqueue_failed');
  assert.equal(normalizeSweepSkippedReason('anything_else'), 'unknown');
});

test('P0 sweeper idempotency workset: same queued IDs -> no duplicate candidates', () => {
  const calls = [{ id: 'same-call', site_id: 'site-1', status: 'won', oci_status: null, confirmed_at: '2026-01-01T00:00:00Z' }];
  const q1 = new Set<string>();
  const first = buildOrphanWorkset(calls, q1);
  assert.equal(first.orphans.length, 1);

  const q2 = new Set<string>(['same-call']);
  const second = buildOrphanWorkset(calls, q2);
  assert.equal(second.orphans.length, 0);
  assert.equal(second.skipped.already_queued, 1);
});

test('P0 projection updater still fail-opens on missing rebuild RPC errors', () => {
  assert.equal(isMissingRebuildProjectionRpc({ code: 'PGRST404', message: 'not found' }), true);
  assert.equal(
    isMissingRebuildProjectionRpc({ message: 'function rebuild_call_projection does not exist' }),
    true
  );
  assert.equal(
    isMissingRebuildProjectionRpc({ message: 'POST /rpc/rebuild_call_projection returned 404' }),
    true
  );
  assert.equal(isMissingRebuildProjectionRpc({ code: 'XX000', message: 'internal error' }), false);
});

test('P0 rebuild_call_projection migration is present in chain', () => {
  const migrationsDir = join(ROOT, 'supabase', 'migrations');
  const files = readdirSync(migrationsDir);
  const hit = files.find((f) => f.includes('rebuild_call_projection'));
  assert.ok(hit, 'expected migration containing rebuild_call_projection in filename');
  const content = readFileSync(join(migrationsDir, hit!), 'utf8');
  assert.ok(content.includes('CREATE OR REPLACE FUNCTION public.rebuild_call_projection'));
});

test('P0 projection table migration is present in chain', () => {
  const migrationsDir = join(ROOT, 'supabase', 'migrations');
  const files = readdirSync(migrationsDir);
  const hit = files.find((f) => f.includes('call_funnel_projection_table'));
  assert.ok(hit, 'expected migration containing call_funnel_projection_table in filename');
  const content = readFileSync(join(migrationsDir, hit!), 'utf8');
  assert.ok(content.includes('CREATE TABLE IF NOT EXISTS public.call_funnel_projection'));
  assert.ok(content.includes('PRIMARY KEY (site_id, call_id)'));
});

test('P0 RPC contract health pack pins required RPCs and grants', () => {
  const path = join(ROOT, 'scripts', 'sql', 'rpc_contract_health.sql');
  assert.ok(existsSync(path), 'scripts/sql/rpc_contract_health.sql must exist');
  const src = readFileSync(path, 'utf8');

  const required = [
    'get_call_session_for_oci',
    'append_worker_transition_batch_v2',
    'apply_marketing_signal_dispatch_batch_v1',
    'rescue_marketing_signals_stale_processing_v1',
    'rebuild_call_projection',
  ];
  for (const fn of required) {
    assert.ok(src.includes(fn), `rpc health pack must include ${fn}`);
  }
  assert.ok(src.includes("grantee IN ('anon', 'authenticated', 'PUBLIC')"));
  assert.ok(src.includes("to_regclass('public.call_funnel_projection')"));
});

test('P0 sweeper route queries both won and sealed states', () => {
  const path = join(ROOT, 'app', 'api', 'cron', 'sweep-unsent-conversions', 'route.ts');
  const src = readFileSync(path, 'utf8');
  assert.ok(src.includes(".or('oci_status.eq.sealed,status.eq.won')"));
  assert.ok(src.includes('buildOrphanWorkset'));
  assert.ok(src.includes('normalizeSweepSkippedReason'));
});

test('P0 get_call_session_for_oci grant restriction migration exists', () => {
  const path = join(ROOT, 'supabase', 'migrations', '20260506112200_restrict_get_call_session_for_oci_grants.sql');
  assert.ok(existsSync(path));
  const src = readFileSync(path, 'utf8');
  assert.ok(src.includes('REVOKE ALL ON FUNCTION public.get_call_session_for_oci(uuid, uuid) FROM anon;'));
  assert.ok(src.includes('REVOKE ALL ON FUNCTION public.get_call_session_for_oci(uuid, uuid) FROM authenticated;'));
  assert.ok(src.includes('GRANT EXECUTE ON FUNCTION public.get_call_session_for_oci(uuid, uuid) TO service_role;'));
});
