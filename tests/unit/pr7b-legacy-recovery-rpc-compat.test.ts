import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = '20261226025000_restore_recover_stuck_offline_conversion_jobs_compat.sql';

function migrationSrc(): string {
  return readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8');
}

test('PR-7B migration exists', () => {
  assert.ok(existsSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION)));
});

test('PR-7B migration creates/replaces recover_stuck_offline_conversion_jobs(integer)', () => {
  const src = migrationSrc();
  assert.ok(src.includes('CREATE OR REPLACE FUNCTION public.recover_stuck_offline_conversion_jobs('));
  assert.ok(src.includes('p_min_age_minutes integer DEFAULT 120'));
  assert.ok(src.includes('RETURNS integer'));
});

test('PR-7B migration enforces security definer + search_path + service_role guard', () => {
  const src = migrationSrc();
  assert.ok(src.includes('SECURITY DEFINER'));
  assert.ok(src.includes("SET search_path TO 'public'"));
  assert.ok(src.includes("auth.role() IS DISTINCT FROM 'service_role'"));
});

test('PR-7B migration revokes broad execute grants and grants service_role', () => {
  const src = migrationSrc();
  assert.ok(src.includes('REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM PUBLIC'));
  assert.ok(src.includes('REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM anon'));
  assert.ok(src.includes('REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM authenticated'));
  assert.ok(src.includes('GRANT EXECUTE ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) TO service_role'));
});

test('PR-7B migration only targets stale PROCESSING rows and does not delete queue rows', () => {
  const src = migrationSrc();
  assert.ok(src.includes("q.status = 'PROCESSING'"));
  assert.ok(src.includes("append_worker_transition_batch_v2("));
  assert.ok(src.includes("'RETRY'"));
  assert.ok(!/delete\s+from\s+offline_conversion_queue/i.test(src));
});

test('rpc_contract_health keeps recover_stuck_offline_conversion_jobs as required integer signature', () => {
  const sql = readFileSync(join(process.cwd(), 'scripts', 'sql', 'rpc_contract_health.sql'), 'utf8');
  assert.ok(sql.includes("'recover_stuck_offline_conversion_jobs', 'integer', true"));
  assert.ok(sql.includes("'recover_stuck_offline_conversion_jobs', 'integer'"));
});

test('row-scoped recovery RPC remains required and unchanged', () => {
  const sql = readFileSync(join(process.cwd(), 'scripts', 'sql', 'rpc_contract_health.sql'), 'utf8');
  const migration = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20261226023000_recover_safe_processing_queue_rows_v1.sql'),
    'utf8'
  );
  assert.ok(sql.includes("'recover_safe_processing_queue_rows_v1', 'uuid[], integer, text, text', true"));
  assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.recover_safe_processing_queue_rows_v1('));
});

test('enforce/strict runtime still uses row-scoped path, legacy path for compatibility only', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'cron', 'providers', 'recover-processing', 'route.ts'),
    'utf8'
  );
  assert.ok(route.includes('if (enforcementRequested)'));
  assert.ok(route.includes("recover_safe_processing_queue_rows_v1"));
  assert.ok(route.includes("recover_stuck_offline_conversion_jobs"));
});
