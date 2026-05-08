import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeEvidenceArtifact } from '../../scripts/release/evidence-contracts.mjs';

const ROOT = process.cwd();

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
  ]) {
    assert.ok(src.includes(code), `reason code ${code} must exist`);
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

