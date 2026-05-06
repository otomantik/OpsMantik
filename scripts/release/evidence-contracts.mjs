import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

export const EVIDENCE_CONTRACT_VERSION = 'evidence_contract_v1';

export const REASON_CODES = {
  MISSING_ENV: 'MISSING_ENV',
  MISSING_SQL_PACK: 'MISSING_SQL_PACK',
  INVALID_SQL_CONTRACT: 'INVALID_SQL_CONTRACT',
  DB_NOT_REQUIRED_FOR_MODE: 'DB_NOT_REQUIRED_FOR_MODE',
  DB_UNAVAILABLE: 'DB_UNAVAILABLE',
  DB_QUERY_FAILED: 'DB_QUERY_FAILED',
  RED_METRIC: 'RED_METRIC',
  PARSER_ERROR: 'PARSER_ERROR',
  UNKNOWN_MODE: 'UNKNOWN_MODE',
  PASS_WITH_WARNINGS: 'PASS_WITH_WARNINGS',
};

export const HEALTH_PACK_CONTRACTS = [
  {
    file: 'scripts/sql/rpc_contract_health.sql',
    pack_id: 'rpc_contract_health',
    contract_version: 'v1',
    db_required: true,
    expected_columns: ['proname', 'contract_status', 'missing_or_drifted_count', 'projection_exists'],
    red_green_criteria: 'RED when missing_or_drifted_count > 0 or unsafe grants exist.',
  },
  {
    file: 'scripts/sql/won_pipeline_health.sql',
    pack_id: 'won_pipeline_health',
    contract_version: 'v1',
    db_required: true,
    expected_columns: ['site_id', 'won_missing_pipeline', 'leak_rate', 'oldest_missing_won_age_seconds'],
    red_green_criteria: 'RED when won_missing_pipeline > 0.',
  },
  {
    file: 'scripts/sql/value_integrity_health.sql',
    pack_id: 'value_integrity_health',
    contract_version: 'v1',
    db_required: true,
    expected_columns: ['policy_version', 'contract_status', 'drifted_rows', 'drift_ratio'],
    red_green_criteria: 'GREEN when drifted_rows = 0 for active sites.',
  },
  {
    file: 'scripts/sql/script_backlog_health.sql',
    pack_id: 'script_backlog_health',
    contract_version: 'v1',
    db_required: true,
    expected_columns: ['site_id', 'offline_conversion_queue_active_count', 'marketing_signals_pending_count'],
    red_green_criteria: 'RED when queue/pending ages breach SLO.',
  },
  {
    file: 'scripts/sql/identity_integrity_health.sql',
    pack_id: 'identity_integrity_health',
    contract_version: 'v1',
    db_required: true,
    expected_columns: ['site_id', 'malformed_phone_hash_count', 'missing_phone_hash_count_where_expected'],
    red_green_criteria: 'RED when malformed or missing hash counters are non-zero.',
  },
  {
    file: 'scripts/sql/scheduler_heartbeat_health.sql',
    pack_id: 'scheduler_heartbeat_health',
    contract_version: 'v1',
    db_required: true,
    expected_columns: ['job_name', 'last_status', 'heartbeat_age_seconds', 'contract_status'],
    red_green_criteria: 'RED when any critical heartbeat is missing, stale, or FAIL.',
  },
];

export const MODE_CONFIG = {
  static: { db_required: false, db_optional: false, ci_safe: true },
  local: { db_required: false, db_optional: true, ci_safe: true },
  staging: { db_required: true, db_optional: false, ci_safe: false },
  production: { db_required: true, db_optional: false, ci_safe: false },
};

export function hashFile(absPath) {
  const src = readFileSync(absPath);
  return createHash('sha256').update(src).digest('hex');
}

export function extractSqlHeaderContract(src) {
  const lines = src.split(/\r?\n/).slice(0, 30);
  const out = {};
  for (const line of lines) {
    const m = line.match(/^--\s*@([a-z_]+)\s*:\s*(.+)\s*$/i);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

export function normalizeEvidenceArtifact(artifact) {
  return JSON.stringify(
    {
      ...artifact,
      metadata: {
        ...artifact.metadata,
        generated_at: '__normalized__',
        git_commit: '__normalized__',
      },
      checks: artifact.checks.map((c) => ({
        ...c,
        started_at: '__normalized__',
        duration_ms: '__normalized__',
      })),
    },
    null,
    2
  );
}

export function buildScorecardMarkdown({ artifact, outputPath }) {
  const lines = [
    '# Release Evidence Scorecard',
    '',
    `- mode: \`${artifact.metadata.mode}\``,
    `- environment: \`${artifact.metadata.environment}\``,
    `- overall_status: \`${artifact.overall_status}\``,
    `- db_checked: \`${artifact.metadata.db_checked}\``,
    `- db_claim_scope: \`${artifact.metadata.db_claim_scope}\``,
    `- unresolved_p0_p1: \`${artifact.summary.blocking_failures}\` blocking findings`,
    `- source_artifact: \`${outputPath}\``,
    '',
    '## Inputs',
    `- checks_total: ${artifact.summary.total_checks}`,
    `- checks_passed: ${artifact.summary.passed_checks}`,
    `- checks_failed: ${artifact.summary.failed_checks}`,
    `- checks_skipped: ${artifact.summary.skipped_checks}`,
    '',
  ];
  return lines.join('\n');
}

export function resolveSqlPackAbsPaths(repoRoot) {
  return HEALTH_PACK_CONTRACTS.map((c) => ({
    ...c,
    absPath: join(repoRoot, c.file),
  }));
}
