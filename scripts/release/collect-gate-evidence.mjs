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
    `- db_checked: \`${artifact.metadata.db_checked}\``,
    `- db_claim_scope: \`${artifact.metadata.db_claim_scope}\``,
    `- db_evidence_status: \`${artifact.metadata.db_evidence_status}\``,
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

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const commit = captureShort('git rev-parse --short HEAD');
  const migrationHead = getLatestMigrationBasename(repoRoot);
  const branch = captureShort('git branch --show-current');
  const nodeVersion = captureShort('node --version');
  const actor = process.env.GITHUB_ACTOR || process.env.OPERATOR_ID || process.env.USERNAME || 'unknown';

  const packs = resolveSqlPackAbsPaths(repoRoot);
  const sqlPackHashes = packs.map((p) => ({
    pack_id: p.pack_id,
    contract_version: p.contract_version,
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
      db_checked: checks.some((c) => c.name.includes('verify-db')),
      db_target: parsed.mode,
      db_claim_scope: checks.some((c) => c.name.includes('verify-db')) ? 'full' : 'none',
      db_evidence_status: dbEvidenceStatus,
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
  mkdirSync(dirname(parsed.output ?? DEFAULT_OUTPUT), { recursive: true });
  writeFileSync(parsed.output ?? DEFAULT_OUTPUT, markdown, 'utf8');
  writeFileSync(join(repoRoot, 'tmp', 'release-gates-normalized.json'), normalizeEvidenceArtifact(artifact), 'utf8');
  writeFileSync(
    join(repoRoot, 'tmp', 'release-evidence-scorecard.md'),
    buildScorecardMarkdown({ artifact, outputPath: relative(repoRoot, parsed.output ?? DEFAULT_OUTPUT) || parsed.output }),
    'utf8'
  );

  console.log(`Release gate evidence written to ${relative(repoRoot, parsed.output ?? DEFAULT_OUTPUT)}`);
  if (artifact.overall_status === 'FAIL') process.exit(1);
}

main();
