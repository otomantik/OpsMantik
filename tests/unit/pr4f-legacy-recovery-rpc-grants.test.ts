import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = '20261226024000_restrict_recover_stuck_offline_conversion_jobs_grants.sql';

test('PR-4F migration exists', () => {
  const path = join(process.cwd(), 'supabase', 'migrations', MIGRATION);
  assert.ok(existsSync(path), `migration missing: ${MIGRATION}`);
});

test('PR-4F migration revokes EXECUTE from PUBLIC/anon/authenticated', () => {
  const src = readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8');
  assert.ok(src.includes('REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM PUBLIC'));
  assert.ok(src.includes('REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM anon'));
  assert.ok(src.includes('REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM authenticated'));
});

test('PR-4F migration grants EXECUTE to service_role', () => {
  const src = readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8');
  assert.ok(src.includes('GRANT EXECUTE ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) TO service_role'));
});

test('PR-4F rpc_contract_health checks legacy recovery RPC and unsafe grants', () => {
  const sql = readFileSync(join(process.cwd(), 'scripts', 'sql', 'rpc_contract_health.sql'), 'utf8');
  assert.ok(sql.includes("'recover_stuck_offline_conversion_jobs', 'integer', true"));
  assert.ok(sql.includes("'recover_stuck_offline_conversion_jobs', 'integer'"));
  assert.ok(sql.includes("'recover_stuck_offline_conversion_jobs'"));
  assert.ok(sql.includes('function_config'));
});

test('PR-4F runtime paths still call legacy RPC (service-role compatibility)', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'cron', 'providers', 'recover-processing', 'route.ts'),
    'utf8'
  );
  const maintenance = readFileSync(
    join(process.cwd(), 'lib', 'oci', 'maintenance', 'run-maintenance.ts'),
    'utf8'
  );
  assert.ok(route.includes('recover_stuck_offline_conversion_jobs'));
  assert.ok(maintenance.includes('recover_stuck_offline_conversion_jobs'));
});

test('PR-4F no delete introduced in legacy grant hardening migration', () => {
  const src = readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8');
  assert.ok(!/delete\s+from\s+offline_conversion_queue/i.test(src));
});
