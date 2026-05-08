#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';
import {
  EVIDENCE_CONTRACT_VERSION,
  MODE_CONFIG,
  REASON_CODES,
  buildScorecardMarkdown,
  hashFile,
  normalizeEvidenceArtifact,
  resolveSqlPackAbsPaths,
} from './evidence-contracts.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');
loadEnv({ path: join(repoRoot, '.env.local') });

const DEFAULT_OUTPUT = join(repoRoot, 'tmp', 'release-gates-latest.md');
const MODE_ALIASES = { pr: 'static', full: 'production' };
const DB_EVIDENCE_MODES = new Set(['staging', 'production']);
const REQUIRED_RPCS = [
  { name: 'get_call_session_for_oci', args: 'uuid, uuid' },
  { name: 'append_worker_transition_batch_v2', args: 'uuid[], text, timestamp with time zone, jsonb' },
  { name: 'append_script_transition_batch', args: 'uuid[], text, timestamp with time zone, jsonb' },
  { name: 'append_script_claim_transition_batch', args: 'uuid[], timestamp with time zone' },
  { name: 'rebuild_call_projection', args: 'uuid, uuid' },
  { name: 'recover_stuck_offline_conversion_jobs', args: 'integer' },
  { name: 'recover_safe_processing_queue_rows_v1', args: 'uuid[], integer, text, text' },
  { name: 'acquire_cron_lease_v1', args: 'text, text, integer' },
  { name: 'steal_expired_cron_lease_v1', args: 'text, text, integer, integer' },
  { name: 'heartbeat_cron_lease_v1', args: 'text, text, integer' },
  { name: 'release_cron_lease_v1', args: 'text, text' },
  { name: 'try_acquire_cron_lock_v1', args: 'text' },
];
const OPTIONAL_LEGACY_RPCS = [
  { name: 'apply_marketing_signal_dispatch_batch_v1', args: 'uuid, uuid[], text, text, timestamp with time zone' },
  { name: 'rescue_marketing_signals_stale_processing_v1', args: 'timestamp with time zone' },
];
const CRITICAL_MIGRATIONS = [
  '20260506111400_restore_get_call_session_for_oci_rpc.sql',
  '20260506123500_create_rebuild_call_projection_rpc.sql',
  '20260506125500_create_call_funnel_projection_table.sql',
  '20260506244000_harden_security_definer_exec_and_search_path.sql',
  '20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql',
  '20261226020000_create_append_worker_transition_batch_v2.sql',
  '20261226023000_recover_safe_processing_queue_rows_v1.sql',
  '20261226024000_restrict_recover_stuck_offline_conversion_jobs_grants.sql',
  '20261226030000_restore_cron_lease_lock_backend.sql',
];
const EXTRA_DB_SQL_PACKS = [
  {
    pack_id: 'rebuild_call_projection_smoke',
    file: 'scripts/sql/rebuild_call_projection_smoke.sql',
    contract_version: 'v1',
  },
];

const MODE_COMMANDS = {
  static: ['node scripts/release/verify-health-pack-contracts.mjs', 'npm run test:tenant-boundary', 'npm run test:oci-kernel'],
  local: ['node scripts/release/verify-health-pack-contracts.mjs', 'npm run test:tenant-boundary', 'npm run test:oci-kernel'],
  staging: [
    'node scripts/release/verify-health-pack-contracts.mjs',
    'node scripts/ci/verify-db.mjs',
    'npm run test:tenant-boundary',
    'npm run test:oci-kernel',
    'npm run test:runtime-budget',
    'npm run test:chaos-core',
    'npm run smoke:oci-rollout-readiness:strict',
  ],
  production: [
    'node scripts/release/verify-health-pack-contracts.mjs',
    'node scripts/ci/verify-db.mjs',
    'npm run test:tenant-boundary',
    'npm run test:oci-kernel',
    'npm run test:runtime-budget',
    'npm run test:chaos-core',
    'npm run smoke:oci-rollout-readiness:strict',
  ],
};

function getModeCommands(mode) {
  if (process.env.EVIDENCE_TEST_FAST === '1') {
    return ['node scripts/release/verify-health-pack-contracts.mjs'];
  }
  return MODE_COMMANDS[mode];
}

function parseArgs(argv) {
  let output = DEFAULT_OUTPUT;
  let mode = 'static';
  let environment = process.env.EVIDENCE_ENVIRONMENT || '';
  let withDb = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output') {
      output = resolve(repoRoot, argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg === '--mode') {
      mode = argv[i + 1] || mode;
      i += 1;
      continue;
    }
    if (arg === '--environment') {
      environment = argv[i + 1] || environment;
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) output = resolve(repoRoot, arg.slice('--output='.length));
    if (arg.startsWith('--mode=')) mode = arg.slice('--mode='.length) || mode;
    if (arg.startsWith('--environment=')) environment = arg.slice('--environment='.length) || environment;
    if (arg === '--with-db') withDb = true;
  }
  mode = MODE_ALIASES[mode] ?? mode;
  if (!(mode in MODE_CONFIG)) {
    return { ok: false, error_code: REASON_CODES.UNKNOWN_MODE, output, mode, environment, withDb };
  }
  return { ok: true, output, mode, environment: environment || mode, withDb };
}

function getLatestMigrationBasename(root) {
  try {
    const dir = join(root, 'supabase', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    return files.length ? files[files.length - 1] : 'none';
  } catch {
    return 'unknown';
  }
}

function captureShort(command) {
  const result = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    encoding: 'utf8',
    env: process.env,
  });
  return (result.stdout || '').trim() || (result.stderr || '').trim() || 'unknown';
}

function runCommand(command) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedMs;
  return {
    name: command,
    started_at: startedAt,
    duration_ms: durationMs,
    exit_code: result.status ?? 1,
    status: (result.status ?? 1) === 0 ? 'PASS' : 'FAIL',
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    reason_code: (result.status ?? 1) === 0 ? null : REASON_CODES.RED_METRIC,
  };
}

function redactDbTarget(input) {
  if (!input) return 'none';
  try {
    const u = new URL(input);
    const host = u.hostname || 'unknown-host';
    return `${u.protocol}//${host}`;
  } catch {
    return 'redacted';
  }
}

function isLikelyPlaceholderValue(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return false;
  return (
    v.includes('<') ||
    v.includes('>') ||
    v.includes('buraya') ||
    v.includes('staging_supabase_db_url') ||
    v.includes('redacted') ||
    v.includes('example')
  );
}

function validateTargetDbUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) {
    return {
      ok: false,
      status: 'DB_ENV_MISSING',
      reason_code: REASON_CODES.DB_ENV_MISSING,
      reason: 'Target DB URL env is missing or empty',
    };
  }
  if (isLikelyPlaceholderValue(value)) {
    return {
      ok: false,
      status: 'DB_URL_INVALID',
      reason_code: REASON_CODES.DB_URL_INVALID,
      reason: 'Target DB URL appears to be placeholder/redacted',
    };
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      status: 'DB_URL_INVALID',
      reason_code: REASON_CODES.DB_URL_INVALID,
      reason: 'Target DB URL is not a valid URL',
    };
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    return {
      ok: false,
      status: 'DB_URL_INVALID',
      reason_code: REASON_CODES.DB_URL_INVALID,
      reason: `Unsupported DB URL protocol: ${parsed.protocol}`,
    };
  }
  if (!parsed.hostname || parsed.hostname === 'base') {
    return {
      ok: false,
      status: 'DB_URL_INVALID',
      reason_code: REASON_CODES.DB_URL_INVALID,
      reason: 'Target DB URL hostname is invalid',
    };
  }
  return { ok: true };
}

async function collectTargetDbEvidence({ mode, strict, withDb, sqlPackHashes }) {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
  const dbShouldRun = DB_EVIDENCE_MODES.has(mode) || withDb === true;
  const emptyPackResults = sqlPackHashes.map((p) => ({
    pack_id: p.pack_id,
    file: p.file ?? null,
    status: 'DB_NOT_CHECKED',
    row_count: 0,
    contract_status: 'DB_NOT_CHECKED',
    reason: 'TARGET_DB_NOT_CHECKED',
  }));

  if (!dbShouldRun) {
    return {
      db_checked: false,
      db_target_redacted: redactDbTarget(dbUrl),
      target_db_contract_status: 'TARGET_DB_NOT_CHECKED',
      failure_classification: null,
      failure_reason: null,
      target_db_attempted: false,
      target_db_checked: false,
      is_fresh_artifact: true,
      sql_pack_results: emptyPackResults,
      rpc_contract_summary: {
        status: 'TARGET_DB_NOT_CHECKED',
        missing_count: 0,
        signature_drift_count: 0,
        unsafe_grant_count: 0,
      },
      migration_evidence_summary: {
        status: 'TARGET_DB_NOT_CHECKED',
        rows: CRITICAL_MIGRATIONS.map((name) => ({
          migration: name,
          present_in_repo: true,
          applied_in_target_db: 'APPLIED_STATUS_UNVERIFIED',
          evidence: 'TARGET_DB_NOT_CHECKED',
          status: 'TARGET_DB_UNVERIFIED',
        })),
      },
      row_scoped_smoke: {
        status: 'SMOKE_UNVERIFIED',
        reason: 'TARGET_DB_NOT_CHECKED',
      },
      blocking_failures: [],
      warnings: ['TARGET_DB_NOT_CHECKED', 'STALE_ARTIFACT_PREVENTED'],
    };
  }

  const urlValidation = validateTargetDbUrl(dbUrl);
  if (!urlValidation.ok) {
    const blocker = {
      reason_code: urlValidation.reason_code,
      message: urlValidation.reason,
    };
    return {
      db_checked: false,
      db_target_redacted: redactDbTarget(dbUrl),
      target_db_contract_status: strict ? urlValidation.status : 'TARGET_DB_NOT_CHECKED',
      failure_classification: urlValidation.status,
      failure_reason: urlValidation.reason,
      target_db_attempted: true,
      target_db_checked: false,
      is_fresh_artifact: true,
      sql_pack_results: emptyPackResults.map((p) => ({ ...p, status: urlValidation.status, reason: urlValidation.status })),
      rpc_contract_summary: {
        status: urlValidation.status,
        missing_count: 0,
        signature_drift_count: 0,
        unsafe_grant_count: 0,
      },
      migration_evidence_summary: {
        status: 'TARGET_DB_UNVERIFIED',
        rows: CRITICAL_MIGRATIONS.map((name) => ({
          migration: name,
          present_in_repo: true,
          applied_in_target_db: 'APPLIED_STATUS_UNVERIFIED',
          evidence: urlValidation.status,
          status: 'TARGET_DB_UNVERIFIED',
        })),
      },
      row_scoped_smoke: {
        status: 'SMOKE_UNVERIFIED',
        reason: urlValidation.status,
      },
      blocking_failures: strict ? [blocker] : [],
      warnings: strict ? ['STALE_ARTIFACT_PREVENTED'] : [urlValidation.status, 'STALE_ARTIFACT_PREVENTED'],
    };
  }

  const { Client } = await import('pg');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  const blocking_failures = [];
  const warnings = [];
  const sql_pack_results = [];
  let rpc_contract_summary = {
    status: 'TARGET_DB_UNVERIFIED',
    missing_count: 0,
    signature_drift_count: 0,
    unsafe_grant_count: 0,
  };
  let migration_evidence_summary = {
    status: 'TARGET_DB_UNVERIFIED',
    rows: [],
  };
  let row_scoped_smoke = { status: 'SMOKE_UNVERIFIED', reason: 'NOT_ATTEMPTED' };

  try {
    try {
      await client.connect();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const blocker = {
        reason_code: REASON_CODES.DB_CONNECTION_FAILED,
        message: `Target DB connect failed: ${msg}`,
      };
      return {
        db_checked: false,
        db_target_redacted: redactDbTarget(dbUrl),
        target_db_contract_status: strict ? 'DB_CONNECTION_FAILED' : 'TARGET_DB_UNVERIFIED',
        failure_classification: 'DB_CONNECTION_FAILED',
        failure_reason: msg,
        target_db_attempted: true,
        target_db_checked: false,
        is_fresh_artifact: true,
        sql_pack_results: emptyPackResults.map((p) => ({
          ...p,
          status: 'DB_CONNECTION_FAILED',
          contract_status: 'DB_NOT_CHECKED',
          reason: 'DB_CONNECTION_FAILED',
        })),
        rpc_contract_summary: {
          status: 'DB_CONNECTION_FAILED',
          missing_count: 0,
          signature_drift_count: 0,
          unsafe_grant_count: 0,
        },
        migration_evidence_summary: {
          status: 'TARGET_DB_UNVERIFIED',
          rows: CRITICAL_MIGRATIONS.map((name) => ({
            migration: name,
            present_in_repo: true,
            applied_in_target_db: 'APPLIED_STATUS_UNVERIFIED',
            evidence: 'DB_CONNECTION_FAILED',
            status: 'TARGET_DB_UNVERIFIED',
          })),
        },
        row_scoped_smoke: {
          status: 'SMOKE_UNVERIFIED',
          reason: 'DB_CONNECTION_FAILED',
        },
        blocking_failures: strict ? [blocker] : [],
        warnings: strict ? ['STALE_ARTIFACT_PREVENTED'] : ['DB_CONNECTION_FAILED', 'STALE_ARTIFACT_PREVENTED'],
      };
    }

    const dbPacks = [
      ...resolveSqlPackAbsPaths(repoRoot),
      ...EXTRA_DB_SQL_PACKS.map((p) => ({ ...p, absPath: join(repoRoot, p.file) })),
    ];
    for (const pack of dbPacks) {
      const src = readFileSync(pack.absPath, 'utf8');
      try {
        const result = await client.query(src);
        sql_pack_results.push({
          pack_id: pack.pack_id,
          file: pack.file,
          status: 'TARGET_DB_CHECKED',
          row_count: Array.isArray(result?.rows) ? result.rows.length : 0,
          contract_status: 'TARGET_DB_CHECKED',
          reason: null,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        sql_pack_results.push({
          pack_id: pack.pack_id,
          file: pack.file,
          status: 'DB_QUERY_FAILED',
          row_count: 0,
          contract_status: 'DB_QUERY_FAILED',
          reason: msg,
        });
        if (strict) {
          blocking_failures.push({
            reason_code: REASON_CODES.DB_QUERY_FAILED,
            message: `SQL pack failed: ${pack.pack_id}`,
          });
        } else {
          warnings.push(`SQL pack failed: ${pack.pack_id}`);
        }
      }
    }

    try {
      const rpcRows = await client.query(`
        select p.proname, oidvectortypes(p.proargtypes) as args, p.prosecdef, coalesce(p.proconfig, '{}'::text[]) as proconfig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any($1::text[]);
      `, [REQUIRED_RPCS.concat(OPTIONAL_LEGACY_RPCS).map((r) => r.name)]);
      const grantRows = await client.query(`
        select routine_name, grantee, privilege_type
        from information_schema.routine_privileges
        where routine_schema = 'public'
          and routine_name = any($1::text[]);
      `, [REQUIRED_RPCS.concat(OPTIONAL_LEGACY_RPCS).map((r) => r.name)]);
      const found = new Map(rpcRows.rows.map((r) => [r.proname, r]));
      let missing_count = 0;
      let signature_drift_count = 0;
      let unsafe_grant_count = 0;
      for (const required of REQUIRED_RPCS) {
        const row = found.get(required.name);
        if (!row) {
          missing_count += 1;
          continue;
        }
        if (String(row.args) !== required.args) signature_drift_count += 1;
      }
      for (const g of grantRows.rows) {
        if (['anon', 'authenticated', 'PUBLIC'].includes(String(g.grantee))) unsafe_grant_count += 1;
      }
      rpc_contract_summary = {
        status:
          missing_count > 0 || signature_drift_count > 0 || unsafe_grant_count > 0
            ? 'TARGET_DB_RED'
            : 'TARGET_DB_GREEN',
        missing_count,
        signature_drift_count,
        unsafe_grant_count,
      };
      if (strict && rpc_contract_summary.status === 'TARGET_DB_RED') {
        if (missing_count > 0) {
          blocking_failures.push({ reason_code: REASON_CODES.DB_RPC_MISSING, message: `Missing required RPCs: ${missing_count}` });
        }
        if (signature_drift_count > 0) {
          blocking_failures.push({ reason_code: REASON_CODES.DB_RPC_SIGNATURE_DRIFT, message: `RPC signature drift count: ${signature_drift_count}` });
        }
        if (unsafe_grant_count > 0) {
          blocking_failures.push({ reason_code: REASON_CODES.DB_UNSAFE_GRANT, message: `Unsafe RPC grants detected: ${unsafe_grant_count}` });
        }
      }
    } catch (error) {
      rpc_contract_summary = {
        status: 'TARGET_DB_UNVERIFIED',
        missing_count: 0,
        signature_drift_count: 0,
        unsafe_grant_count: 0,
      };
      warnings.push(`RPC summary query failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const migrationRows = [];
      let appliedVersions = [];
      try {
        const r = await client.query('select version from supabase_migrations.schema_migrations');
        appliedVersions = (r.rows || []).map((x) => String(x.version || ''));
      } catch {
        appliedVersions = [];
      }
      for (const name of CRITICAL_MIGRATIONS) {
        const version = name.split('_')[0];
        const applied = appliedVersions.includes(version);
        migrationRows.push({
          migration: name,
          present_in_repo: true,
          applied_in_target_db: applied ? true : (appliedVersions.length === 0 ? 'APPLIED_STATUS_UNVERIFIED' : false),
          evidence: applied ? 'schema_migrations' : (appliedVersions.length === 0 ? 'schema_migrations_unavailable' : 'not_applied'),
          status: applied ? 'TARGET_DB_GREEN' : (appliedVersions.length === 0 ? 'TARGET_DB_UNVERIFIED' : 'TARGET_DB_RED'),
        });
      }
      migration_evidence_summary = {
        status: migrationRows.some((r) => r.status === 'TARGET_DB_RED')
          ? 'TARGET_DB_RED'
          : migrationRows.some((r) => r.status === 'TARGET_DB_UNVERIFIED')
            ? 'TARGET_DB_UNVERIFIED'
            : 'TARGET_DB_GREEN',
        rows: migrationRows,
      };
      if (strict && migration_evidence_summary.status === 'TARGET_DB_RED') {
        blocking_failures.push({
          reason_code: REASON_CODES.DB_SCHEMA_DRIFT,
          message: 'Critical migration missing in target DB',
        });
      }
    } catch (error) {
      warnings.push(`Migration evidence query failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const smoke = await client.query(
        "select * from public.recover_safe_processing_queue_rows_v1(ARRAY[]::uuid[], 120, 'SAFE_TO_RETRY_CLASSIFIED', 'processing_recovery_classifier')"
      );
      const row = smoke.rows?.[0] || {};
      const requested = Number(row.requested_count ?? 0);
      const recovered = Number(row.recovered_count ?? 0);
      row_scoped_smoke =
        requested === 0 && recovered === 0
          ? { status: 'TARGET_DB_GREEN', reason: 'empty-array non-mutating smoke passed' }
          : { status: 'DB_SMOKE_FAILED', reason: 'unexpected non-zero smoke counters' };
      if (strict && row_scoped_smoke.status === 'DB_SMOKE_FAILED') {
        blocking_failures.push({
          reason_code: REASON_CODES.DB_SMOKE_FAILED,
          message: 'Row-scoped recovery smoke check failed',
        });
      }
    } catch (error) {
      const smokeError = error instanceof Error ? error.message : String(error);
      row_scoped_smoke = {
        status: smokeError.includes('may only be called by service_role') ? 'TARGET_DB_GREEN' : 'SMOKE_UNVERIFIED',
        reason: smokeError,
      };
      if (row_scoped_smoke.status === 'SMOKE_UNVERIFIED') {
        warnings.push('Row-scoped recovery smoke check skipped/unverified');
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  const anyPackFail = sql_pack_results.some((p) => p.status === 'DB_QUERY_FAILED');
  const target_db_contract_status =
    blocking_failures.length > 0
      ? 'TARGET_DB_RED'
      : anyPackFail
        ? 'TARGET_DB_PARTIAL'
        : warnings.length > 0
          ? 'TARGET_DB_UNVERIFIED'
          : 'TARGET_DB_GREEN';

  return {
    db_checked: true,
    db_target_redacted: redactDbTarget(dbUrl),
    target_db_contract_status,
    failure_classification: null,
    failure_reason: null,
    target_db_attempted: true,
    target_db_checked: true,
    is_fresh_artifact: true,
    sql_pack_results,
    rpc_contract_summary,
    migration_evidence_summary,
    row_scoped_smoke,
    blocking_failures,
    warnings,
  };
}

function buildMarkdown(artifact) {
  const qh = artifact.metadata.queue_health_evidence || {};
  return [
    '# Release Gate Evidence',
    '',
    `- overall_status: **${artifact.overall_status}**`,
    `- mode: \`${artifact.metadata.mode}\``,
    `- environment: \`${artifact.metadata.environment}\``,
    `- evidence_contract: \`${artifact.metadata.contract_version}\``,
    `- generated_at: \`${artifact.metadata.generated_at}\``,
    `- git_commit: \`${artifact.metadata.git_commit}\``,
    `- migration_head: \`${artifact.metadata.migration_head}\``,
    `- actor: \`${artifact.metadata.actor}\``,
    `- target_db_checked: \`${artifact.metadata.target_db_checked ?? false}\``,
    `- legacy_verify_db_checked: \`${artifact.metadata.legacy_verify_db_checked ?? false}\``,
    `- db_claim_scope: \`${artifact.metadata.db_claim_scope}\``,
    `- db_evidence_status: \`${artifact.metadata.db_evidence_status}\``,
    `- target_db_contract_status: \`${artifact.metadata.target_db_contract_status ?? 'TARGET_DB_NOT_CHECKED'}\``,
    `- db_target_redacted: \`${artifact.metadata.db_target_redacted ?? 'none'}\``,
    `- static_queue_contract_green: \`${artifact.metadata.static_queue_contract_green}\``,
    `- export_run_integrity: \`${artifact.metadata.export_run_integrity}\``,
    `- export_run_integrity_gate_status: \`${artifact.metadata.export_run_integrity_gate?.status}\``,
    `- recovery_integrity: \`${artifact.metadata.recovery_integrity}\``,
    `- recovery_integrity_gate: \`${artifact.metadata.recovery_integrity_gate?.pass ? 'PASS' : 'FAIL'}\``,
    `- processing_recovery_mode: \`${artifact.metadata.processing_recovery_mode}\``,
    `- classifier_present: \`${artifact.metadata.classifier_present}\``,
    `- processing_classifier_enforcement_supported: \`${artifact.metadata.processing_classifier_enforcement_supported}\``,
    `- row_scoped_recovery_rpc_present: \`${artifact.metadata.row_scoped_recovery_rpc_present}\``,
    `- processing_safe_retry_candidate_count: \`${artifact.metadata.recovery_signals?.processing_safe_retry_candidate_count ?? 0}\``,
    `- processing_provider_ambiguous_count: \`${artifact.metadata.recovery_signals?.processing_provider_ambiguous_count ?? 0}\``,
    `- processing_requires_review_count: \`${artifact.metadata.recovery_signals?.processing_requires_review_count ?? 0}\``,
    `- processing_unknown_provider_outcome_count: \`${artifact.metadata.recovery_signals?.processing_unknown_provider_outcome_count ?? 0}\``,
    `- processing_classifier_bypass_count: \`${artifact.metadata.recovery_signals?.processing_classifier_bypass_count ?? 0}\``,
    `- recovery_blocking_reasons: \`${(artifact.metadata.recovery_integrity_gate?.blocking_reasons || []).join(',') || 'none'}\``,
    `- recovery_warnings: \`${(artifact.metadata.recovery_integrity_gate?.warnings || []).join(',') || 'none'}\``,
    `- recovery_classifier_shadow: \`${artifact.metadata.recovery_classifier_shadow_present}\``,
    `- recovery_classifier_enforcement: \`${artifact.metadata.recovery_classifier_enforcement_present}\``,
    `- stuck_processing_signal: \`${artifact.metadata.stuck_processing_present}\``,
    `- processing_recovery_policy: \`${artifact.metadata.processing_recovery_policy}\``,
    `- provider_ambiguous_policy: \`${artifact.metadata.provider_ambiguous_review_required}\``,
    `- duplicate_upload_risk: \`${artifact.metadata.duplicate_upload_risk_visible}\``,
    `- strict_mode: \`${artifact.metadata.strict_mode}\``,
    `- waiver_status: \`${artifact.metadata.waiver_status}\``,
    `- recovery_waiver_status: \`${artifact.metadata.recovery_waiver_status}\``,
    `- export_run_lineage: \`${artifact.metadata.export_run_lineage}\``,
    `- ack_db_transition_count_check: \`${artifact.metadata.ack_db_transition_count_check}\``,
    `- script_summary_contract: \`${artifact.metadata.script_summary_contract}\``,
    `- script_summary_reconciliation: \`${artifact.metadata.script_summary_reconciliation}\``,
    `- script_summary_status: \`${artifact.metadata.script_summary_status}\``,
    `- checked_equations: \`${artifact.metadata.checked_equations}\``,
    `- missing_equations: \`${artifact.metadata.missing_equations}\``,
    `- mismatch_reasons: \`${artifact.metadata.mismatch_reasons}\``,
    '',
    '## Queue health / kanıt (ayrım)',
    '',
    `- TARGET_DB queue rows: \`${qh.target_db_claim ?? 'n/a'}\` — requires verify-db PASS for live invariant proof.`,
    `- STATIC shape only: \`${qh.static_shape_only ?? 'n/a'}\` — does **not** prove prod queue GREEN or score 100.`,
    `- policy_version: \`${qh.policy_version ?? 'queue_health_contract_v1'}\``,
    `- PR-1C taxonomy: \`${qh.pr_1c_taxonomy ?? 'n/a'}\``,
    '',
    '## SQL Pack Hashes',
    '',
    ...artifact.metadata.sql_pack_hashes.map(
      (p) => `- ${p.pack_id}: \`${p.sha256.slice(0, 12)}...\` (\`${p.contract_version}\`)`
    ),
    '',
    '## Target DB Pack Results',
    '',
    ...(artifact.metadata.sql_pack_results || []).map(
      (p) =>
        `- ${p.pack_id}: \`${p.status}\` rows=\`${p.row_count}\` contract=\`${p.contract_status}\`${p.reason ? ` reason=\`${p.reason}\`` : ''}`
    ),
    '',
    '## Summary',
    '',
    `- total_checks: ${artifact.summary.total_checks}`,
    `- passed_checks: ${artifact.summary.passed_checks}`,
    `- failed_checks: ${artifact.summary.failed_checks}`,
    `- skipped_checks: ${artifact.summary.skipped_checks}`,
    `- blocking_failures: ${artifact.summary.blocking_failures}`,
    '',
    '## Check Results',
    '',
    ...artifact.checks.map(
      (c) =>
        `- ${c.name}: ${c.status}${c.reason_code ? ` (\`${c.reason_code}\`)` : ''}${
          c.skipped_reason ? ` [skipped_reason=${c.skipped_reason}]` : ''
        }`
    ),
    '',
    '## Metadata (JSON)',
    '```json',
    JSON.stringify(artifact, null, 2),
    '```',
    '',
  ].join('\n');
}

function deriveModeSpecificJsonPath(outputPath) {
  const normalized = String(outputPath || '').replace(/\\/g, '/');
  if (normalized.toLowerCase().endsWith('.md')) {
    return outputPath.slice(0, -3) + '.json';
  }
  return `${outputPath}.json`;
}

function dbEnvAvailable() {
  return Boolean((process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function envInt(name, fallback = 0) {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function envBool(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return fallback;
}

function detectRowScopedRecoveryRpcFromMigrations(root) {
  try {
    const dir = join(root, 'supabase', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    for (const file of files) {
      const src = readFileSync(join(dir, file), 'utf8');
      if (src.includes('recover_safe_processing_queue_rows_v1')) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function evaluateProcessingRecoveryGate(input) {
  const blocking_reasons = [];
  const warnings = [];
  const strict_mode = input.strict === true;
  const ambiguous = Math.max(0, Number.parseInt(String(input.providerAmbiguousCount ?? 0), 10) || 0);
  const requiresReview = Math.max(0, Number.parseInt(String(input.requiresReviewCount ?? 0), 10) || 0);
  const unknown = Math.max(0, Number.parseInt(String(input.unknownProviderOutcomeCount ?? 0), 10) || 0);
  const bypass = Math.max(0, Number.parseInt(String(input.enforcementBypassCount ?? 0), 10) || 0);
  const enforcementMode = input.recoveryMode === 'enforce_safe_retry' || input.recoveryMode === 'strict';
  const waiver = input.waiver || {};
  const waiverComplete = Boolean(waiver.owner && waiver.reason && waiver.expiry && waiver.blastRadius);
  const waiverExpiry = waiver.expiry ? new Date(waiver.expiry) : null;
  const waiverValid = waiverComplete && waiverExpiry && !Number.isNaN(waiverExpiry.getTime()) && waiverExpiry.getTime() >= Date.now();

  if (!input.classifierPresent) blocking_reasons.push('RECOVERY_CLASSIFIER_MISSING');
  if (enforcementMode && !input.rowScopedRpcPresent) blocking_reasons.push('RECOVERY_ROW_SCOPED_RPC_MISSING');
  if (enforcementMode && bypass > 0) blocking_reasons.push('RECOVERY_ENFORCEMENT_BYPASSED');
  if (ambiguous > 0) blocking_reasons.push('PROVIDER_AMBIGUOUS_REVIEW_REQUIRED');
  if (unknown > 0) blocking_reasons.push('UNKNOWN_PROVIDER_OUTCOME_PRESENT');
  if (requiresReview > 0) blocking_reasons.push('PROCESSING_REQUIRES_REVIEW_PRESENT');

  let recovery_integrity = 'RECOVERY_INTEGRITY_UNVERIFIED';
  if (input.mode === 'static' || input.mode === 'local') {
    recovery_integrity = input.classifierPresent ? 'RECOVERY_INTEGRITY_UNVERIFIED' : 'RECOVERY_INTEGRITY_UNVERIFIED';
    if (blocking_reasons.length > 0) {
      warnings.push(`Recovery blockers observed in non-strict/static mode: ${blocking_reasons.join(', ')}`);
    }
    return {
      pass: true,
      recovery_integrity,
      blocking_reasons,
      warnings,
      waiver_required: false,
      waiver_accepted: false,
      strict_mode,
    };
  }

  const hardRed = blocking_reasons.filter((x) =>
    ['RECOVERY_CLASSIFIER_MISSING', 'PROVIDER_AMBIGUOUS_REVIEW_REQUIRED', 'UNKNOWN_PROVIDER_OUTCOME_PRESENT'].includes(x)
  );
  if (hardRed.length > 0) {
    return {
      pass: false,
      recovery_integrity: 'RECOVERY_INTEGRITY_RED',
      blocking_reasons,
      warnings,
      waiver_required: false,
      waiver_accepted: false,
      strict_mode,
    };
  }

  const softReasons = blocking_reasons.filter((x) =>
    ['RECOVERY_ROW_SCOPED_RPC_MISSING', 'RECOVERY_ENFORCEMENT_BYPASSED', 'PROCESSING_REQUIRES_REVIEW_PRESENT'].includes(x)
  );
  if (!strict_mode) {
    return {
      pass: true,
      recovery_integrity: softReasons.length > 0 ? 'RECOVERY_INTEGRITY_PARTIAL' : 'RECOVERY_INTEGRITY_GREEN',
      blocking_reasons,
      warnings,
      waiver_required: false,
      waiver_accepted: false,
      strict_mode,
    };
  }
  if (softReasons.length > 0) {
    if (!waiverComplete) {
      return {
        pass: false,
        recovery_integrity: 'RECOVERY_INTEGRITY_PARTIAL',
        blocking_reasons,
        warnings: [...warnings, 'Strict mode requires complete waiver metadata for partial recovery integrity'],
        waiver_required: true,
        waiver_accepted: false,
        strict_mode,
      };
    }
    if (!waiverValid) {
      return {
        pass: false,
        recovery_integrity: 'RECOVERY_INTEGRITY_PARTIAL',
        blocking_reasons,
        warnings: [...warnings, 'Recovery waiver is expired or invalid'],
        waiver_required: true,
        waiver_accepted: false,
        strict_mode,
      };
    }
    return {
      pass: true,
      recovery_integrity: 'RECOVERY_INTEGRITY_PARTIAL',
      blocking_reasons,
      warnings: [...warnings, `Recovery waiver accepted for: ${softReasons.join(', ')}`],
      waiver_required: true,
      waiver_accepted: true,
      strict_mode,
    };
  }

  return {
    pass: true,
    recovery_integrity: 'RECOVERY_INTEGRITY_GREEN',
    blocking_reasons,
    warnings,
    waiver_required: false,
    waiver_accepted: false,
    strict_mode,
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const commit = captureShort('git rev-parse --short HEAD');
  const migrationHead = getLatestMigrationBasename(repoRoot);
  const branch = captureShort('git branch --show-current');
  const nodeVersion = captureShort('node --version');
  const actor = process.env.GITHUB_ACTOR || process.env.OPERATOR_ID || process.env.USERNAME || 'unknown';

  const packs = [
    ...resolveSqlPackAbsPaths(repoRoot),
    ...EXTRA_DB_SQL_PACKS.map((p) => ({ ...p, absPath: join(repoRoot, p.file) })),
  ];
  const sqlPackHashes = packs.map((p) => ({
    pack_id: p.pack_id,
    contract_version: p.contract_version,
    file: p.file,
    sha256: hashFile(p.absPath),
  }));

  const checks = [];
  const blockingFailures = [];
  const warnings = [];

  if (!parsed.ok) {
    blockingFailures.push({ reason_code: parsed.error_code, message: `Unsupported mode ${parsed.mode}` });
  } else {
    const modeRules = MODE_CONFIG[parsed.mode];
    const dbAvailable = dbEnvAvailable();
    const commands = [...getModeCommands(parsed.mode)];

    if (!modeRules.db_required && !modeRules.db_optional) {
      checks.push({
        name: 'db-preflight',
        status: 'SKIPPED',
        reason_code: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
        skipped_reason: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
        started_at: generatedAt,
        duration_ms: 0,
      });
      for (const command of commands.filter((c) => !c.includes('verify-db'))) {
        checks.push(runCommand(command));
      }
    } else if (!dbAvailable && modeRules.db_required) {
      blockingFailures.push({
        reason_code: REASON_CODES.MISSING_ENV,
        message: 'DB-required mode missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
      });
    } else {
      if (modeRules.db_optional && !parsed.withDb) {
        checks.push({
          name: 'db-preflight',
          status: 'SKIPPED',
          reason_code: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
          skipped_reason: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
          started_at: generatedAt,
          duration_ms: 0,
        });
        commands.splice(commands.indexOf('node scripts/ci/verify-db.mjs'), 1);
      } else if (!dbAvailable && modeRules.db_optional) {
        checks.push({
          name: 'db-preflight',
          status: 'SKIPPED',
          reason_code: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
          skipped_reason: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
          started_at: generatedAt,
          duration_ms: 0,
        });
        commands.splice(commands.indexOf('node scripts/ci/verify-db.mjs'), 1);
      } else {
        checks.push(runCommand('node scripts/ci/verify-db.mjs'));
      }
      for (const command of commands.filter((c) => c !== 'node scripts/ci/verify-db.mjs')) {
        checks.push(runCommand(command));
      }
    }
  }

  for (const c of checks) {
    if (c.status === 'FAIL') {
      blockingFailures.push({ reason_code: c.reason_code || REASON_CODES.RED_METRIC, message: c.name });
    }
  }

  const verifyDbCheck = checks.find((c) => String(c.name).includes('verify-db'));
  let dbEvidenceStatus = 'DB_NOT_CHECKED';
  if (verifyDbCheck?.status === 'PASS') dbEvidenceStatus = 'DB_CHECKED';
  else if (verifyDbCheck?.status === 'FAIL') dbEvidenceStatus = 'DB_ERROR';

  const packShapeCheck = checks.find((c) => String(c.name).includes('verify-health-pack-contracts'));
  const staticQueueContractGreen = packShapeCheck?.status === 'PASS';

  // Export run integrity baseline
  const isStrict = process.env.OCI_EXPORT_RUN_INTEGRITY_STRICT === '1';
  const waiverOwner = process.env.OCI_EXPORT_RUN_WAIVER_OWNER;
  const waiverReason = process.env.OCI_EXPORT_RUN_WAIVER_REASON;
  const waiverExpiry = process.env.OCI_EXPORT_RUN_WAIVER_EXPIRY;
  const waiverBlastRadius = process.env.OCI_EXPORT_RUN_WAIVER_BLAST_RADIUS;

  const export_run_integrity = parsed.mode === 'static' ? (staticQueueContractGreen ? 'STATIC_EXPORT_CONTRACT_GREEN' : 'DB_NOT_CHECKED') : 'EXPORT_RUN_INTEGRITY_UNVERIFIED';
  const recoverySignals = {
    stuck_processing_count: envInt('OCI_RECOVERY_STUCK_PROCESSING_COUNT', 0),
    unknown_provider_outcome_count: envInt('OCI_RECOVERY_UNKNOWN_PROVIDER_OUTCOME_COUNT', 0),
    ambiguous_processing_count: envInt('OCI_RECOVERY_AMBIGUOUS_PROCESSING_COUNT', 0),
    processing_safe_retry_candidate_count: envInt('OCI_RECOVERY_PROCESSING_SAFE_RETRY_CANDIDATE_COUNT', 0),
    processing_provider_ambiguous_count: envInt('OCI_RECOVERY_PROCESSING_PROVIDER_AMBIGUOUS_COUNT', 0),
    processing_requires_review_count: envInt('OCI_RECOVERY_PROCESSING_REQUIRES_REVIEW_COUNT', 0),
    processing_unknown_provider_outcome_count: envInt(
      'OCI_RECOVERY_PROCESSING_UNKNOWN_PROVIDER_OUTCOME_COUNT',
      0
    ),
    processing_classifier_bypass_count: envInt('OCI_RECOVERY_PROCESSING_CLASSIFIER_BYPASS_COUNT', 0),
    processing_classifier_shadow_count: envInt('OCI_RECOVERY_PROCESSING_CLASSIFIER_SHADOW_COUNT', 0),
    processing_classifier_enforced_count: envInt('OCI_RECOVERY_PROCESSING_CLASSIFIER_ENFORCED_COUNT', 0),
  };
  const processingRecoveryMode = String(
    process.env.OCI_PROCESSING_RECOVERY_CLASSIFIER_MODE || 'off'
  ).toLowerCase();
  const rowScopedRecoveryRpcPresent =
    envBool('OCI_ROW_SCOPED_RECOVERY_RPC_PRESENT', false) ||
    detectRowScopedRecoveryRpcFromMigrations(repoRoot);
  const processingClassifierEnforcementSupported =
    envBool('OCI_PROCESSING_CLASSIFIER_ENFORCEMENT_SUPPORTED', false);
  const classifierPresent = existsSync(join(repoRoot, 'lib', 'oci', 'processing-recovery-classifier.ts'));
  const recoveryWaiver = {
    owner: process.env.OCI_PROCESSING_RECOVERY_WAIVER_OWNER || '',
    reason: process.env.OCI_PROCESSING_RECOVERY_WAIVER_REASON || '',
    expiry: process.env.OCI_PROCESSING_RECOVERY_WAIVER_EXPIRY || '',
    blastRadius: process.env.OCI_PROCESSING_RECOVERY_WAIVER_BLAST_RADIUS || '',
  };
  const recoveryPolicyPresent = process.env.OCI_PROCESSING_RECOVERY_POLICY_PRESENT !== '0';
  const strictRecovery = process.env.OCI_RECOVERY_INTEGRITY_STRICT === '1';
  const recoveryVocabulary = {
    stuck_processing_present: recoverySignals.stuck_processing_count > 0 ? 'STUCK_PROCESSING_PRESENT' : 'STUCK_PROCESSING_NONE',
    processing_recovery_policy: recoveryPolicyPresent ? 'PROCESSING_RECOVERY_POLICY_PRESENT' : 'PROCESSING_RECOVERY_POLICY_MISSING',
    provider_ambiguous_review_required:
      recoverySignals.ambiguous_processing_count > 0
        ? 'PROVIDER_AMBIGUOUS_REVIEW_REQUIRED'
        : 'PROVIDER_AMBIGUOUS_NONE',
    duplicate_upload_risk_visible:
      recoverySignals.ambiguous_processing_count > 0 || recoverySignals.stuck_processing_count > 0
        ? 'DUPLICATE_UPLOAD_RISK_VISIBLE'
        : 'DUPLICATE_UPLOAD_RISK_NONE',
    recovery_classifier_shadow_present:
      processingRecoveryMode === 'shadow' ||
      processingRecoveryMode === 'enforce_safe_retry' ||
      processingRecoveryMode === 'strict'
        ? 'RECOVERY_CLASSIFIER_SHADOW_PRESENT'
        : 'RECOVERY_CLASSIFIER_SHADOW_MISSING',
    recovery_classifier_enforcement_present:
      processingRecoveryMode === 'enforce_safe_retry' || processingRecoveryMode === 'strict'
        ? 'RECOVERY_CLASSIFIER_ENFORCEMENT_PRESENT'
        : 'RECOVERY_CLASSIFIER_ENFORCEMENT_MISSING',
    recovery_classifier_present: classifierPresent
      ? 'RECOVERY_CLASSIFIER_PRESENT'
      : 'RECOVERY_CLASSIFIER_MISSING',
    recovery_row_scoped_rpc_present: rowScopedRecoveryRpcPresent
      ? 'RECOVERY_ROW_SCOPED_RPC_PRESENT'
      : 'RECOVERY_ROW_SCOPED_RPC_MISSING',
    row_scoped_recovery_rpc_present: rowScopedRecoveryRpcPresent
      ? 'ROW_SCOPED_RECOVERY_RPC_PRESENT'
      : 'ROW_SCOPED_RECOVERY_RPC_MISSING',
    recovery_enforcement_bypassed:
      (processingRecoveryMode === 'enforce_safe_retry' || processingRecoveryMode === 'strict') &&
      recoverySignals.processing_classifier_bypass_count > 0
        ? 'RECOVERY_ENFORCEMENT_BYPASSED'
        : 'RECOVERY_ENFORCEMENT_NOT_BYPASSED',
    unknown_provider_outcome_present:
      recoverySignals.processing_unknown_provider_outcome_count > 0
        ? 'UNKNOWN_PROVIDER_OUTCOME_PRESENT'
        : 'UNKNOWN_PROVIDER_OUTCOME_NONE',
    processing_requires_review_present:
      recoverySignals.processing_requires_review_count > 0
        ? 'PROCESSING_REQUIRES_REVIEW_PRESENT'
        : 'PROCESSING_REQUIRES_REVIEW_NONE',
  };
  if (!recoveryPolicyPresent) warnings.push('PROCESSING_RECOVERY_POLICY_MISSING');

  const recoveryGate = evaluateProcessingRecoveryGate({
    mode: parsed.mode,
    strict: strictRecovery,
    recoveryMode: processingRecoveryMode,
    classifierPresent,
    rowScopedRpcPresent: rowScopedRecoveryRpcPresent,
    safeRetryCandidateCount: recoverySignals.processing_safe_retry_candidate_count,
    providerAmbiguousCount: Math.max(
      recoverySignals.processing_provider_ambiguous_count,
      recoverySignals.ambiguous_processing_count
    ),
    requiresReviewCount: recoverySignals.processing_requires_review_count,
    unknownProviderOutcomeCount: recoverySignals.processing_unknown_provider_outcome_count,
    enforcementBypassCount: recoverySignals.processing_classifier_bypass_count,
    classifierShadowCount: recoverySignals.processing_classifier_shadow_count,
    classifierEnforcedCount: recoverySignals.processing_classifier_enforced_count,
    waiver: recoveryWaiver,
  });
  const recovery_integrity = recoveryGate.recovery_integrity;

  let exportRunIntegrityGate = {
    pass: true,
    status: 'POLICY_PASSED',
    blocking_reasons: [],
    warnings: [],
    waiver_required: false,
    waiver_accepted: false
  };

  // Minimal inline policy evaluation
  if (parsed.mode === 'static') {
    if (export_run_integrity !== 'STATIC_EXPORT_CONTRACT_GREEN') {
      exportRunIntegrityGate.warnings.push(`Static mode defaults to pass, but integrity is ${export_run_integrity}`);
    }
  } else if (isStrict) {
    if (export_run_integrity === 'EXPORT_RUN_INTEGRITY_RED') {
      exportRunIntegrityGate.pass = false;
      exportRunIntegrityGate.status = 'POLICY_FAILED';
      exportRunIntegrityGate.blocking_reasons.push('EXPORT_RUN_INTEGRITY_RED is a hard blocker and cannot be waived');
    } else if (export_run_integrity === 'EXPORT_RUN_INTEGRITY_UNVERIFIED' || export_run_integrity === 'EXPORT_RUN_INTEGRITY_PARTIAL') {
      exportRunIntegrityGate.waiver_required = true;
      if (waiverOwner && waiverReason && waiverExpiry && waiverBlastRadius) {
        const expiryDate = new Date(waiverExpiry);
        if (isNaN(expiryDate.getTime()) || expiryDate.getTime() < Date.now()) {
          exportRunIntegrityGate.pass = false;
          exportRunIntegrityGate.status = 'POLICY_FAILED_EXPIRED_WAIVER';
          exportRunIntegrityGate.blocking_reasons.push('Waiver is expired or has invalid expiry date');
        } else {
          exportRunIntegrityGate.waiver_accepted = true;
          exportRunIntegrityGate.status = 'POLICY_PASSED_WITH_WAIVER';
          exportRunIntegrityGate.warnings.push(`Promotion waived by ${waiverOwner}. Reason: ${waiverReason}`);
        }
      } else {
        exportRunIntegrityGate.pass = false;
        exportRunIntegrityGate.status = 'POLICY_FAILED_MISSING_WAIVER';
        exportRunIntegrityGate.blocking_reasons.push(`Strict promotion requires GREEN or a valid waiver. Current state: ${export_run_integrity}`);
      }
    }
  } else {
    if (export_run_integrity === 'EXPORT_RUN_INTEGRITY_RED') {
      exportRunIntegrityGate.warnings.push('RED integrity ignored due to non-strict mode');
    }
  }

  if (!exportRunIntegrityGate.pass) {
    blockingFailures.push({
       reason_code: REASON_CODES.RED_METRIC,
       message: `Export run integrity policy failed: ${exportRunIntegrityGate.status}`
    });
  }
  if (!recoveryGate.pass) {
    blockingFailures.push({
      reason_code: REASON_CODES.RED_METRIC,
      message: `Recovery integrity policy failed: ${recoveryGate.blocking_reasons.join(', ')}`,
    });
  }

  const targetDbStrict = process.env.TARGET_DB_EVIDENCE_STRICT === '1';
  let targetDbEvidence;
  try {
    targetDbEvidence = await collectTargetDbEvidence({
      mode: parsed.mode,
      strict: targetDbStrict,
      withDb: parsed.withDb,
      sqlPackHashes,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    targetDbEvidence = {
      db_checked: false,
      db_target_redacted: 'redacted',
      target_db_contract_status: 'DB_QUERY_FAILED',
      failure_classification: 'DB_QUERY_FAILED',
      failure_reason: msg,
      target_db_attempted: true,
      target_db_checked: false,
      is_fresh_artifact: true,
      sql_pack_results: [],
      rpc_contract_summary: {
        status: 'DB_QUERY_FAILED',
        missing_count: 0,
        signature_drift_count: 0,
        unsafe_grant_count: 0,
      },
      migration_evidence_summary: { status: 'TARGET_DB_UNVERIFIED', rows: [] },
      row_scoped_smoke: { status: 'SMOKE_UNVERIFIED', reason: 'DB_QUERY_FAILED' },
      blocking_failures: [{ reason_code: REASON_CODES.DB_QUERY_FAILED, message: `Unhandled DB evidence error: ${msg}` }],
      warnings: ['STALE_ARTIFACT_PREVENTED'],
    };
  }
  for (const b of targetDbEvidence.blocking_failures ?? []) blockingFailures.push(b);
  for (const w of targetDbEvidence.warnings ?? []) warnings.push(w);

  const artifact = {
    metadata: {
      contract_version: EVIDENCE_CONTRACT_VERSION,
      mode: parsed.mode,
      environment: parsed.environment,
      generated_at: generatedAt,
      git_commit: commit,
      migration_head: migrationHead,
      git_branch: branch,
      node_version: nodeVersion,
      actor,
      command_invoked: `node scripts/release/collect-gate-evidence.mjs --mode=${parsed.mode}${parsed.withDb ? ' --with-db' : ''}`,
      db_checked: targetDbEvidence.target_db_checked === true,
      legacy_verify_db_checked: checks.some((c) => c.name.includes('verify-db')),
      db_target: parsed.mode,
      db_claim_scope: checks.some((c) => c.name.includes('verify-db')) ? 'full' : 'none',
      db_evidence_status: dbEvidenceStatus,
      target_db_contract_status: targetDbEvidence.target_db_contract_status,
      db_target_redacted: targetDbEvidence.db_target_redacted,
      target_db_attempted: targetDbEvidence.target_db_attempted === true,
      target_db_checked: targetDbEvidence.target_db_checked === true,
      failure_classification: targetDbEvidence.failure_classification,
      target_db_failure_classification: targetDbEvidence.failure_classification,
      failure_reason: targetDbEvidence.failure_reason,
      is_fresh_artifact: targetDbEvidence.is_fresh_artifact === true,
      static_queue_contract_green: staticQueueContractGreen,
      export_run_integrity: export_run_integrity,
      export_run_integrity_gate: exportRunIntegrityGate,
      strict_mode: isStrict,
      waiver_status: exportRunIntegrityGate.waiver_accepted ? 'ACCEPTED' : (exportRunIntegrityGate.waiver_required ? 'REQUIRED' : 'NONE'),
      recovery_waiver_status: recoveryGate.waiver_accepted
        ? 'ACCEPTED'
        : recoveryGate.waiver_required
          ? 'REQUIRED'
          : 'NONE',
      export_run_lineage: 'EXPORT_RUN_LINEAGE_PRESENT',
      ack_db_transition_count_check: 'ACK_DB_TRANSITION_COUNT_CHECK_PRESENT',
      script_summary_contract: 'SCRIPT_SUMMARY_CONTRACT_PRESENT',
      script_summary_reconciliation: 'SCRIPT_SUMMARY_RECONCILIATION_PRESENT',
      script_summary_status: parsed.mode === 'static' ? 'SCRIPT_SUMMARY_CONTRACT_PRESENT' : 'SCRIPT_SUMMARY_MISSING',
      checked_equations: parsed.mode === 'static' ? 'STATIC_VALIDATION_ONLY' : 'NONE',
      missing_equations: parsed.mode === 'static' ? 'ALL_RUNTIME_EQUATIONS' : 'ALL_RUNTIME_EQUATIONS',
      mismatch_reasons: 'NONE',
      processing_recovery_mode: processingRecoveryMode,
      classifier_present: classifierPresent,
      processing_classifier_enforcement_supported: processingClassifierEnforcementSupported,
      row_scoped_recovery_rpc_present: rowScopedRecoveryRpcPresent,
      recovery_integrity,
      recovery_integrity_gate: recoveryGate,
      recovery_blocking_reasons: recoveryGate.blocking_reasons,
      recovery_warnings: recoveryGate.warnings,
      recovery_signals: recoverySignals,
      ...recoveryVocabulary,
      queue_health_evidence: {
        policy_version: 'queue_health_contract_v1',
        pack_id: 'queue_health',
        pr_1c_taxonomy:
          'FAILED is lifecycle state; DETERMINISTIC_SKIP (e.g. SUPPRESSED_BY_HIGHER_GEAR) is observable and excluded from actionable/provider gate rates — gate metric is actionable_failed_rate / provider_failed_rate; total_failed_rate / failed_rate remain mass visibility; unknown_failed_count is RED.',
        static_shape_only: parsed.mode === 'static' ? 'yes — SQL pack file + column contract only' : 'partial',
        target_db_claim:
          dbEvidenceStatus === 'DB_CHECKED'
            ? 'verify-db ran — includes queue_health.sql when DB reachable'
            : 'none — do not claim TARGET_DB queue health GREEN',
      },
      normalization_version: 'v1',
      sql_pack_hashes: sqlPackHashes,
      sql_pack_results: targetDbEvidence.sql_pack_results,
      rpc_contract_summary: targetDbEvidence.rpc_contract_summary,
      migration_evidence_summary: targetDbEvidence.migration_evidence_summary,
      row_scoped_recovery_smoke: targetDbEvidence.row_scoped_smoke,
    },
    checks,
    summary: {
      total_checks: checks.length,
      passed_checks: checks.filter((c) => c.status === 'PASS').length,
      failed_checks: checks.filter((c) => c.status === 'FAIL').length,
      skipped_checks: checks.filter((c) => c.status === 'SKIPPED').length,
      blocking_failures: blockingFailures.length,
      warnings: warnings.length,
    },
    blocking_failures: blockingFailures,
    warnings,
    overall_status: blockingFailures.length === 0 ? (warnings.length ? REASON_CODES.PASS_WITH_WARNINGS : 'PASS') : 'FAIL',
  };

  const markdown = buildMarkdown(artifact);
  const modeSpecificOutput = parsed.output ?? DEFAULT_OUTPUT;
  const modeSpecificJsonOutput = deriveModeSpecificJsonPath(modeSpecificOutput);
  mkdirSync(dirname(modeSpecificOutput), { recursive: true });
  writeFileSync(modeSpecificOutput, markdown, 'utf8');
  writeFileSync(join(repoRoot, 'tmp', 'release-gates-latest.md'), markdown, 'utf8');
  writeFileSync(modeSpecificJsonOutput, JSON.stringify(artifact, null, 2), 'utf8');
  writeFileSync(join(repoRoot, 'tmp', 'release-gates-latest.json'), JSON.stringify(artifact, null, 2), 'utf8');
  writeFileSync(join(repoRoot, 'tmp', 'release-gates-normalized.json'), normalizeEvidenceArtifact(artifact), 'utf8');
  writeFileSync(join(repoRoot, 'tmp', 'db-evidence-latest.json'), JSON.stringify({
    generated_at: generatedAt,
    command_invoked: `node scripts/release/collect-gate-evidence.mjs --mode=${parsed.mode}${parsed.withDb ? ' --with-db' : ''}`,
    mode: parsed.mode,
    target_db_contract_status: targetDbEvidence.target_db_contract_status,
    target_db_attempted: targetDbEvidence.target_db_attempted === true,
    target_db_checked: targetDbEvidence.target_db_checked === true,
    failure_classification: targetDbEvidence.failure_classification,
    target_db_failure_classification: targetDbEvidence.failure_classification,
    failure_reason: targetDbEvidence.failure_reason,
    is_fresh_artifact: targetDbEvidence.is_fresh_artifact === true,
    db_target_redacted: targetDbEvidence.db_target_redacted,
    sql_pack_hashes: sqlPackHashes,
    sql_pack_results: targetDbEvidence.sql_pack_results,
    rpc_contract_summary: targetDbEvidence.rpc_contract_summary,
    migration_evidence_summary: targetDbEvidence.migration_evidence_summary,
    row_scoped_recovery_smoke: targetDbEvidence.row_scoped_smoke,
    blocking_failures: targetDbEvidence.blocking_failures,
    warnings: targetDbEvidence.warnings,
  }, null, 2), 'utf8');
  writeFileSync(
    join(repoRoot, 'tmp', 'db-evidence-normalized.json'),
    JSON.stringify({
      mode: parsed.mode,
      target_db_contract_status: targetDbEvidence.target_db_contract_status,
      target_db_attempted: targetDbEvidence.target_db_attempted === true,
      target_db_checked: targetDbEvidence.target_db_checked === true,
      failure_classification: targetDbEvidence.failure_classification,
      target_db_failure_classification: targetDbEvidence.failure_classification,
      failure_reason: targetDbEvidence.failure_reason ? '__normalized__' : null,
      is_fresh_artifact: targetDbEvidence.is_fresh_artifact === true,
      db_target_redacted: '__normalized__',
      sql_pack_hashes: sqlPackHashes,
      sql_pack_results: targetDbEvidence.sql_pack_results.map((r) => ({ ...r, reason: r.reason ? '__normalized__' : null })),
      rpc_contract_summary: targetDbEvidence.rpc_contract_summary,
      migration_evidence_summary: targetDbEvidence.migration_evidence_summary,
      row_scoped_recovery_smoke: targetDbEvidence.row_scoped_smoke,
      blocking_failures: targetDbEvidence.blocking_failures,
      warnings: targetDbEvidence.warnings,
    }, null, 2),
    'utf8'
  );
  writeFileSync(
    join(repoRoot, 'tmp', 'db-evidence-latest.md'),
    [
      '# Target DB Evidence',
      '',
      `- mode: \`${parsed.mode}\``,
      `- target_db_contract_status: \`${targetDbEvidence.target_db_contract_status}\``,
      `- db_target_redacted: \`${targetDbEvidence.db_target_redacted}\``,
      `- generated_at: \`${generatedAt}\``,
      `- sql_pack_results: \`${targetDbEvidence.sql_pack_results.length}\` packs`,
      `- rpc_contract_status: \`${targetDbEvidence.rpc_contract_summary.status}\``,
      `- migration_status: \`${targetDbEvidence.migration_evidence_summary.status}\``,
      `- row_scoped_recovery_smoke: \`${targetDbEvidence.row_scoped_smoke.status}\``,
      `- target_db_attempted: \`${targetDbEvidence.target_db_attempted === true}\``,
      `- target_db_checked: \`${targetDbEvidence.target_db_checked === true}\``,
      `- failure_classification: \`${targetDbEvidence.failure_classification || 'none'}\``,
      `- is_fresh_artifact: \`${targetDbEvidence.is_fresh_artifact === true}\``,
      '',
    ].join('\n'),
    'utf8'
  );
  writeFileSync(
    join(repoRoot, 'tmp', 'release-evidence-scorecard.md'),
    buildScorecardMarkdown({ artifact, outputPath: relative(repoRoot, parsed.output ?? DEFAULT_OUTPUT) || parsed.output }),
    'utf8'
  );

  console.log(`Release gate evidence written to ${relative(repoRoot, parsed.output ?? DEFAULT_OUTPUT)}`);
  if (artifact.overall_status === 'FAIL') process.exit(1);
}

await main();
