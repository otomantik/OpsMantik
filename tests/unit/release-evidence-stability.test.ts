import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeEvidenceArtifact } from '../../scripts/release/evidence-contracts.mjs';

const ROOT = process.cwd();

/** Clear every URL key read by `scripts/release/resolve-target-db-url.mjs` so strict DB tests do not inherit `.env.local`. */
function envWithoutTargetDbUrls(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    SUPABASE_DB_POOLER_URL: '',
    DATABASE_POOLER_URL: '',
    SUPABASE_POOLER_URL: '',
    SUPABASE_TRANSACTION_POOLER_URL: '',
    SUPABASE_DATABASE_URL: '',
    SUPABASE_DB_URL: '',
    DATABASE_URL: '',
  };
}

test('queue_health SQL pack contract lists PR-1C taxonomy columns', () => {
  const src = readFileSync(join(ROOT, 'scripts/release/evidence-contracts.mjs'), 'utf8');
  for (const col of [
    'actionable_failed_rate',
    'provider_failed_rate',
    'deterministic_skip_count',
    'suppressed_higher_gear_count',
    'unknown_failed_count',
    'total_failed_count',
    'ambiguous_processing_count',
    'unknown_provider_outcome_count',
    'processing_with_provider_request_id_count',
    'processing_without_run_summary_count',
    'processing_safe_retry_candidate_count',
    'processing_requires_review_count',
  ]) {
    assert.ok(src.includes(`'${col}'`), `queue_health contract must require ${col}`);
  }
});

test('won pipeline health contract uses unrepresented leak semantics', () => {
  const src = readFileSync(join(ROOT, 'scripts/release/evidence-contracts.mjs'), 'utf8');
  for (const col of [
    'won_represented_active_count',
    'won_represented_completed_count',
    'won_represented_failed_terminal_count',
    'won_pipeline_represented_total',
    'won_missing_unrepresented_count',
    'won_missing_pipeline_count',
  ]) {
    assert.ok(src.includes(`'${col}'`), `won pipeline contract must require ${col}`);
  }
  assert.ok(src.includes('RED when won_missing_unrepresented_count > 0.'));
});

test('release evidence includes PR-4 recovery integrity vocabulary', () => {
  const src = readFileSync(join(ROOT, 'scripts/release/collect-gate-evidence.mjs'), 'utf8');
  for (const token of [
    'STUCK_PROCESSING_PRESENT',
    'PROCESSING_RECOVERY_POLICY_PRESENT',
    'PROVIDER_AMBIGUOUS_REVIEW_REQUIRED',
    'DUPLICATE_UPLOAD_RISK_VISIBLE',
    'RECOVERY_INTEGRITY_UNVERIFIED',
    'RECOVERY_INTEGRITY_PARTIAL',
    'RECOVERY_INTEGRITY_RED',
    'RECOVERY_INTEGRITY_GREEN',
    'processing_recovery_mode',
    'recovery_integrity_gate',
    'classifier_present',
    'processing_classifier_enforcement_supported',
    'row_scoped_recovery_rpc_present',
    'RECOVERY_CLASSIFIER_SHADOW_PRESENT',
    'RECOVERY_CLASSIFIER_ENFORCEMENT_PRESENT',
    'RECOVERY_CLASSIFIER_PRESENT',
    'RECOVERY_CLASSIFIER_MISSING',
    'RECOVERY_ROW_SCOPED_RPC_PRESENT',
    'RECOVERY_ROW_SCOPED_RPC_MISSING',
    'RECOVERY_ENFORCEMENT_BYPASSED',
    'UNKNOWN_PROVIDER_OUTCOME_PRESENT',
    'PROCESSING_REQUIRES_REVIEW_PRESENT',
    'ROW_SCOPED_RECOVERY_RPC_PRESENT',
    'ROW_SCOPED_RECOVERY_RPC_MISSING',
    'processing_safe_retry_candidate_count',
    'processing_provider_ambiguous_count',
    'processing_requires_review_count',
    'processing_unknown_provider_outcome_count',
  ]) {
    assert.ok(src.includes(token), `recovery token ${token} must exist`);
  }
});

test('queue_health SQL exposes PR-4 stuck-processing visibility columns', () => {
  const sql = readFileSync(join(ROOT, 'scripts/sql/queue_health.sql'), 'utf8');
  for (const col of [
    'ambiguous_processing_count',
    'unknown_provider_outcome_count',
    'processing_with_provider_request_id_count',
    'processing_without_run_summary_count',
    'processing_safe_retry_candidate_count',
    'processing_requires_review_count',
  ]) {
    assert.ok(sql.includes(col), `queue_health.sql must expose ${col}`);
  }
});

test('release evidence contract exposes stable reason codes', () => {
  const src = readFileSync(join(ROOT, 'scripts/release/evidence-contracts.mjs'), 'utf8');
  for (const code of [
    'MISSING_ENV',
    'MISSING_SQL_PACK',
    'INVALID_SQL_CONTRACT',
    'DB_NOT_REQUIRED_FOR_MODE',
    'DB_UNAVAILABLE',
    'DB_QUERY_FAILED',
    'RED_METRIC',
    'PARSER_ERROR',
    'UNKNOWN_MODE',
    'PASS_WITH_WARNINGS',
    'DB_ENV_MISSING',
    'DB_SCHEMA_DRIFT',
    'DB_GRANT_DRIFT',
    'DB_RPC_MISSING',
    'DB_RPC_SIGNATURE_DRIFT',
    'DB_UNSAFE_GRANT',
    'DB_SMOKE_FAILED',
    'DB_URL_INVALID',
    'DB_CONNECTION_FAILED',
    'STALE_ARTIFACT_PREVENTED',
    'SCRIPT_SUMMARY_TARGET_MISSING',
    'OCI_EVIDENCE_INCOMPLETE_TARGET_ENV',
    'OCI_EVIDENCE_QUEUE_TARGET_MISSING',
    'OCI_EVIDENCE_QUEUE_NOT_TERMINAL',
  ]) {
    assert.ok(src.includes(code), `reason code ${code} must exist`);
  }
});

test('release evidence includes target DB contract statuses', () => {
  const src = readFileSync(join(ROOT, 'scripts/release/collect-gate-evidence.mjs'), 'utf8');
  for (const token of [
    'TARGET_DB_CHECKED',
    'TARGET_DB_NOT_CHECKED',
    'TARGET_DB_GREEN',
    'TARGET_DB_RED',
    'TARGET_DB_PARTIAL',
    'TARGET_DB_UNVERIFIED',
    'DB_ENV_MISSING',
    'DB_QUERY_FAILED',
    'DB_RPC_MISSING',
    'DB_RPC_SIGNATURE_DRIFT',
    'DB_UNSAFE_GRANT',
    'DB_SMOKE_FAILED',
    'recover_safe_processing_queue_rows_v1',
    'recover_stuck_offline_conversion_jobs',
  ]) {
    assert.ok(src.includes(token), `target-db token ${token} must exist`);
  }
});

test('queue-only SQL packs guard optional marketing_signals residue', () => {
  for (const file of ['value_integrity_health.sql', 'script_backlog_health.sql', 'oci_time_ssot_health.sql']) {
    const src = readFileSync(join(ROOT, 'scripts/sql', file), 'utf8');
    assert.ok(src.includes("to_regclass('public.marketing_signals')"), `${file} must guard table presence`);
    assert.ok(!src.includes('FROM public.marketing_signals'), `${file} must not hard-reference marketing_signals`);
  }
});

test('identity_integrity_health sample query keeps CTE scope local', () => {
  const src = readFileSync(join(ROOT, 'scripts/sql/identity_integrity_health.sql'), 'utf8');
  assert.ok(src.includes('-- Sample rows for deterministic verification / repair queue triage.\nWITH candidates AS ('));
});

test('rpc contract list keeps queue/recovery canonical set', () => {
  const src = readFileSync(join(ROOT, 'scripts/release/collect-gate-evidence.mjs'), 'utf8');
  assert.ok(src.includes("append_script_claim_transition_batch', args: 'uuid[], timestamp with time zone'"));
  assert.ok(src.includes("const OPTIONAL_LEGACY_RPCS = ["));
  assert.ok(src.includes("apply_marketing_signal_dispatch_batch_v1"));
  assert.ok(src.includes('dependency_drift_count'));
  assert.ok(src.includes("acquire_cron_lease_v1', args: 'text, text, integer'"));
  assert.ok(src.includes("steal_expired_cron_lease_v1', args: 'text, text, integer, integer'"));
  assert.ok(src.includes("heartbeat_cron_lease_v1', args: 'text, text, integer'"));
  assert.ok(src.includes("release_cron_lease_v1', args: 'text, text'"));
  assert.ok(src.includes("try_acquire_cron_lock_v1', args: 'text'"));
});

test('migration evidence supports equivalent-name resolution with object proof', () => {
  const src = readFileSync(join(ROOT, 'scripts/release/collect-gate-evidence.mjs'), 'utf8');
  for (const token of [
    'CRITICAL_MIGRATION_EQUIVALENTS',
    '20261226030000_restore_cron_lease_lock_backend.sql',
    '20260508140142',
    'restore_cron_lease_lock_backend',
    'schema_migrations_equivalent+object_proof',
    'equivalent_migration_detected',
    'equivalent_object_proof',
    "to_regclass('public.cron_leases')",
    "to_regprocedure('public.acquire_cron_lease_v1(text,text,integer)')",
  ]) {
    assert.ok(src.includes(token), `equivalent migration token ${token} must exist`);
  }
});

test('release evidence reports UNKNOWN_MODE deterministically', () => {
  const run = spawnSync('node scripts/release/collect-gate-evidence.mjs --mode=invalid-mode --output tmp/evidence-unknown.md', {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, EVIDENCE_TEST_FAST: '1' },
  });
  assert.notEqual(run.status, 0);
  const out = readFileSync(join(ROOT, 'tmp/evidence-unknown.md'), 'utf8');
  assert.ok(out.includes('UNKNOWN_MODE'));
});

test('strict recovery integrity fails on ambiguous processing without waiver', () => {
  const run = spawnSync(
    'node scripts/release/collect-gate-evidence.mjs --mode=production --output tmp/evidence-recovery-strict.md',
    {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      env: {
        ...process.env,
        EVIDENCE_TEST_FAST: '1',
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        OCI_RECOVERY_INTEGRITY_STRICT: '1',
        OCI_RECOVERY_AMBIGUOUS_PROCESSING_COUNT: '2',
        OCI_PROCESSING_RECOVERY_POLICY_PRESENT: '1',
      },
    }
  );
  assert.notEqual(run.status, 0);
  const out = readFileSync(join(ROOT, 'tmp/evidence-recovery-strict.md'), 'utf8');
  assert.ok(out.includes('RECOVERY_INTEGRITY_RED'));
  assert.ok(out.includes('PROVIDER_AMBIGUOUS_REVIEW_REQUIRED'));
});

test('static/pr evidence does not claim RECOVERY_INTEGRITY_GREEN', () => {
  const run = spawnSync(
    'node scripts/release/collect-gate-evidence.mjs --mode=static --output tmp/evidence-recovery-static.md',
    {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      env: {
        ...process.env,
        EVIDENCE_TEST_FAST: '1',
      },
    }
  );
  assert.equal(run.status, 0);
  const out = readFileSync(join(ROOT, 'tmp/evidence-recovery-static.md'), 'utf8');
  assert.ok(!out.includes('RECOVERY_INTEGRITY_GREEN'));
  assert.ok(out.includes('RECOVERY_INTEGRITY_UNVERIFIED'));
  assert.ok(out.includes('TARGET_DB_NOT_CHECKED'));
  const gates = JSON.parse(readFileSync(join(ROOT, 'tmp/release-gates-latest.json'), 'utf8'));
  assert.equal(gates.metadata.target_db_checked, false);
});

test('strict target DB mode fails closed when DB env missing', () => {
  const run = spawnSync(
    'node scripts/release/collect-gate-evidence.mjs --mode=production --output tmp/evidence-target-db-strict-missing.md',
    {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      env: {
        ...envWithoutTargetDbUrls(process.env),
        EVIDENCE_TEST_FAST: '1',
        TARGET_DB_EVIDENCE_STRICT: '1',
        NEXT_PUBLIC_SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
      },
    }
  );
  assert.notEqual(run.status, 0);
  const out = readFileSync(join(ROOT, 'tmp/evidence-target-db-strict-missing.md'), 'utf8');
  assert.ok(out.includes('DB_ENV_MISSING'));
  const json = JSON.parse(readFileSync(join(ROOT, 'tmp/db-evidence-latest.json'), 'utf8'));
  assert.equal(json.target_db_contract_status, 'DB_ENV_MISSING');
  assert.equal(json.is_fresh_artifact, true);
});

test('strict target DB mode rejects placeholder URL and writes fresh artifacts', () => {
  const run = spawnSync(
    'node scripts/release/collect-gate-evidence.mjs --mode=staging --output tmp/evidence-target-db-placeholder.md',
    {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      env: {
        ...envWithoutTargetDbUrls(process.env),
        EVIDENCE_TEST_FAST: '1',
        TARGET_DB_EVIDENCE_STRICT: '1',
        SUPABASE_DB_URL: '<STAGING_SUPABASE_DB_URL>',
      },
    }
  );
  assert.notEqual(run.status, 0);
  const out = readFileSync(join(ROOT, 'tmp/evidence-target-db-placeholder.md'), 'utf8');
  assert.ok(out.includes('DB_URL_INVALID'));
  const json = JSON.parse(readFileSync(join(ROOT, 'tmp/db-evidence-latest.json'), 'utf8'));
  assert.equal(json.target_db_contract_status, 'DB_URL_INVALID');
  assert.equal(json.is_fresh_artifact, true);
  assert.ok(!JSON.stringify(json).includes('<STAGING_SUPABASE_DB_URL>'));
  const gates = JSON.parse(readFileSync(join(ROOT, 'tmp/release-gates-latest.json'), 'utf8'));
  assert.equal(gates.metadata.target_db_checked, false);
  assert.notEqual(gates.metadata.db_checked, true);
  assert.equal(typeof gates.metadata.legacy_verify_db_checked, 'boolean');
});

test('strict target DB mode rejects malformed URL and writes fresh artifacts', () => {
  const run = spawnSync(
    'node scripts/release/collect-gate-evidence.mjs --mode=staging --output tmp/evidence-target-db-malformed.md',
    {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      env: {
        ...envWithoutTargetDbUrls(process.env),
        EVIDENCE_TEST_FAST: '1',
        TARGET_DB_EVIDENCE_STRICT: '1',
        SUPABASE_DB_URL: 'not-a-url',
      },
    }
  );
  assert.notEqual(run.status, 0);
  const out = readFileSync(join(ROOT, 'tmp/evidence-target-db-malformed.md'), 'utf8');
  assert.ok(out.includes('DB_URL_INVALID'));
  const json = JSON.parse(readFileSync(join(ROOT, 'tmp/db-evidence-latest.json'), 'utf8'));
  assert.equal(json.target_db_contract_status, 'DB_URL_INVALID');
  assert.equal(json.is_fresh_artifact, true);
});

test('staging mode updates mode-specific and latest artifact aliases together', () => {
  const run = spawnSync(
    'node scripts/release/collect-gate-evidence.mjs --mode=staging --output tmp/release-gates-staging.md',
    {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      env: {
        ...envWithoutTargetDbUrls(process.env),
        EVIDENCE_TEST_FAST: '1',
        TARGET_DB_EVIDENCE_STRICT: '1',
        SUPABASE_DB_URL: 'not-a-url',
      },
    }
  );
  assert.notEqual(run.status, 0);
  assert.equal(existsSync(join(ROOT, 'tmp/release-gates-staging.json')), true);
  assert.equal(existsSync(join(ROOT, 'tmp/release-gates-latest.md')), true);
  const staging = JSON.parse(readFileSync(join(ROOT, 'tmp/release-gates-staging.json'), 'utf8'));
  const latest = JSON.parse(readFileSync(join(ROOT, 'tmp/release-gates-latest.json'), 'utf8'));
  assert.equal(staging.metadata.mode, 'staging');
  assert.equal(latest.metadata.mode, 'staging');
  assert.equal(staging.metadata.generated_at, latest.metadata.generated_at);
});

test('production script exists in package.json', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    pkg.scripts?.['release:evidence:production'],
    'node scripts/release/collect-gate-evidence.mjs --mode=production --output tmp/release-gates-production.md'
  );
});

test('production mode updates production artifact and latest alias together', () => {
  const run = spawnSync(
    'node scripts/release/collect-gate-evidence.mjs --output tmp/release-gates-production.md',
    {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      env: {
        ...envWithoutTargetDbUrls(process.env),
        EVIDENCE_TEST_FAST: '1',
        RELEASE_EVIDENCE_MODE: 'production',
        TARGET_DB_EVIDENCE_STRICT: '1',
        SUPABASE_DB_URL: 'not-a-url',
      },
    }
  );
  assert.notEqual(run.status, 0);
  assert.equal(existsSync(join(ROOT, 'tmp/release-gates-production.json')), true);
  const prod = JSON.parse(readFileSync(join(ROOT, 'tmp/release-gates-production.json'), 'utf8'));
  const latest = JSON.parse(readFileSync(join(ROOT, 'tmp/release-gates-latest.json'), 'utf8'));
  assert.equal(prod.metadata.mode, 'production');
  assert.equal(latest.metadata.mode, 'production');
  assert.equal(prod.metadata.generated_at, latest.metadata.generated_at);
  assert.equal(prod.metadata.target_db_checked, false);
  assert.equal(prod.metadata.target_db_contract_status, 'DB_URL_INVALID');
});

test('production evidence does not leak DB URL secrets', () => {
  const run = spawnSync(
    'node scripts/release/collect-gate-evidence.mjs --mode=production --output tmp/evidence-prod-secret-redaction.md',
    {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      env: {
        ...envWithoutTargetDbUrls(process.env),
        EVIDENCE_TEST_FAST: '1',
        TARGET_DB_EVIDENCE_STRICT: '1',
        SUPABASE_DB_URL: 'postgresql://user:supersecret@/postgres',
      },
    }
  );
  assert.notEqual(run.status, 0);
  const db = readFileSync(join(ROOT, 'tmp/db-evidence-latest.json'), 'utf8');
  const gates = readFileSync(join(ROOT, 'tmp/release-gates-latest.json'), 'utf8');
  assert.ok(!db.includes('supersecret'));
  assert.ok(!gates.includes('supersecret'));
});

test('release evidence exports production drill and dossier metadata fields', () => {
  const src = readFileSync(join(ROOT, 'scripts/release/collect-gate-evidence.mjs'), 'utf8');
  for (const token of [
    'production_rollback_drill_documented',
    'export_freeze_runbook_present',
    'production_promotion_dossier_present',
    'production_go_decision',
  ]) {
    assert.ok(src.includes(token), `production metadata token ${token} must exist`);
  }
});

test('normalized evidence artifact is replay-stable', () => {
  const base = {
    metadata: { generated_at: 'a', git_commit: 'b', mode: 'static' },
    checks: [{ name: 'x', status: 'PASS', started_at: 't1', duration_ms: 1 }],
    overall_status: 'PASS',
  };
  const next = {
    metadata: { generated_at: 'z', git_commit: 'y', mode: 'static' },
    checks: [{ name: 'x', status: 'PASS', started_at: 't2', duration_ms: 99 }],
    overall_status: 'PASS',
  };
  assert.equal(normalizeEvidenceArtifact(base), normalizeEvidenceArtifact(next));
});

