import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = '20261226023000_recover_safe_processing_queue_rows_v1.sql';

test('PR-4D.1 migration creates recover_safe_processing_queue_rows_v1', () => {
  const path = join(process.cwd(), 'supabase', 'migrations', MIGRATION);
  assert.ok(existsSync(path), `migration missing: ${MIGRATION}`);
  const src = readFileSync(path, 'utf8');
  assert.ok(src.includes('CREATE OR REPLACE FUNCTION public.recover_safe_processing_queue_rows_v1'));
});

test('PR-4D.1 RPC signature is pinned', () => {
  const src = readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8');
  assert.ok(src.includes('p_queue_ids uuid[]'));
  assert.ok(src.includes('p_min_age_minutes integer DEFAULT 120'));
  assert.ok(src.includes('p_recovery_reason text DEFAULT'));
  assert.ok(src.includes('p_actor text DEFAULT'));
  assert.ok(src.includes('requested_count integer'));
  assert.ok(src.includes('recovered_count integer'));
  assert.ok(src.includes('skipped_missing_id_count integer'));
});

test('PR-4D.1 RPC grants are service_role only', () => {
  const src = readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8');
  assert.ok(src.includes("auth.role() IS DISTINCT FROM 'service_role'"));
  assert.ok(src.includes('GRANT EXECUTE ON FUNCTION public.recover_safe_processing_queue_rows_v1'));
  assert.ok(src.includes('TO service_role'));
  assert.ok(src.includes('REVOKE ALL ON FUNCTION public.recover_safe_processing_queue_rows_v1'));
  assert.ok(src.includes('FROM anon'));
  assert.ok(src.includes('FROM authenticated'));
});

test('PR-4D.1 RPC only updates supplied stale PROCESSING rows (not COMPLETED)', () => {
  const src = readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8');
  assert.ok(src.includes("q.status = 'PROCESSING'"));
  assert.ok(src.includes('unnest(v_ids)'));
  assert.ok(src.includes("q.status IN ('COMPLETED', 'COMPLETED_UNVERIFIED', 'FAILED', 'DEAD_LETTER_QUARANTINE', 'VOIDED_BY_REVERSAL')"));
  assert.ok(src.includes("'BLOCKED_PRECEDING_SIGNALS'") || src.includes("q.status <> 'PROCESSING'"));
  assert.ok(src.includes('q.claimed_at < v_cutoff OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff)'));
  assert.ok(src.includes('append_sweeper_transition_batch'));
});

test('PR-4D.1 route/maintenance parse table-returning RPC recovered_count correctly', () => {
  const routeSrc = readFileSync(
    join(process.cwd(), 'app', 'api', 'cron', 'providers', 'recover-processing', 'route.ts'),
    'utf8'
  );
  const maintSrc = readFileSync(join(process.cwd(), 'lib', 'oci', 'maintenance', 'run-maintenance.ts'), 'utf8');
  assert.ok(routeSrc.includes('Array.isArray(data)'), 'route handles table-returning RPC array payload');
  assert.ok(maintSrc.includes('Array.isArray(data)'), 'maintenance handles table-returning RPC array payload');
});

test('PR-4D.1 runtime enforce path uses row-scoped RPC and avoids broad RPC branch', () => {
  const routeSrc = readFileSync(
    join(process.cwd(), 'app', 'api', 'cron', 'providers', 'recover-processing', 'route.ts'),
    'utf8'
  );
  assert.ok(routeSrc.includes('recover_safe_processing_queue_rows_v1'));
  assert.ok(routeSrc.includes('pickSafeRetryRowIds'));
  assert.ok(routeSrc.includes("if (enforcementRequested)"));
  assert.ok(routeSrc.includes('recover_stuck_offline_conversion_jobs'), 'legacy compatibility path retained');
});

test('PR-4D.1 rpc_contract_health tracks row-scoped recovery RPC', () => {
  const sql = readFileSync(join(process.cwd(), 'scripts', 'sql', 'rpc_contract_health.sql'), 'utf8');
  assert.ok(sql.includes('recover_safe_processing_queue_rows_v1'));
  assert.ok(sql.includes('uuid[], integer, text, text'));
});

test('PR-4D.1 release evidence exposes enforcement support and row-scoped RPC presence', () => {
  const src = readFileSync(join(process.cwd(), 'scripts', 'release', 'collect-gate-evidence.mjs'), 'utf8');
  assert.ok(src.includes('processing_classifier_enforcement_supported'));
  assert.ok(src.includes('row_scoped_recovery_rpc_present'));
  assert.ok(src.includes('ROW_SCOPED_RECOVERY_RPC_PRESENT'));
  assert.ok(src.includes('ROW_SCOPED_RECOVERY_RPC_MISSING'));
});

test('PR-4D.1 no queue deletion introduced in row-scoped migration/runtime', () => {
  const migration = readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8');
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'cron', 'providers', 'recover-processing', 'route.ts'),
    'utf8'
  );
  assert.ok(!/delete\s+from\s+offline_conversion_queue/i.test(migration));
  assert.ok(!/delete\s+from\s+offline_conversion_queue/i.test(route));
});
