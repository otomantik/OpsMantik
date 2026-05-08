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
    expected_columns: [
      'site_id',
      'parity_enforcement_mode',
      'offline_conversion_queue_active_count',
      'marketing_signals_pending_count',
      'marketing_signals_queue_parity_gap_count',
    ],
    red_green_criteria:
      'RED when queue upload backlog ages breach SLO, or parity mode is enforce and marketing_signals_queue_parity_gap_count > 0; pending count remains legacy/audit pressure.',
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
  {
    file: 'scripts/sql/oci_time_ssot_health.sql',
    pack_id: 'oci_time_ssot_health',
    contract_version: 'v1',
    db_required: true,
    expected_columns: ['surface', 'drifted_rows', 'contract_status'],
    red_green_criteria: 'RED when call-bound OCI conversion timestamps drift from occurred_at.',
  },
  {
    file: 'scripts/sql/queue_health.sql',
    pack_id: 'queue_health',
    contract_version: 'v1',
    db_required: true,
    expected_columns: [
      'policy_version',
      'site_id',
      'contract_status',
      'queue_health_status',
      'blocking_reasons',
      'retry_rate',
      'failed_rate',
      'total_failed_rate',
      'total_failed_count',
      'actionable_failed_rate',
      'provider_failed_rate',
      'deterministic_skip_rate',
      'stuck_processing_count',
      'won_missing_pipeline',
      'deterministic_skip_count',
      'suppressed_higher_gear_count',
      'provider_failed_count',
      'policy_failed_count',
      'unknown_failed_count',
      'actionable_failed_count',
      'dead_letter_count',
    ],
    red_green_criteria:
      'Operational queue invariants (lib/oci/queue-health-contract.ts). PR-1C: actionable_failed_rate / provider_failed_rate gates; deterministic skips visible, excluded from actionable numerator; unknown_failed_count>0 RED.',
  },
  {
    file: 'scripts/sql/export_closure_gap_audit.sql',
    pack_id: 'export_closure_gap_audit',
    contract_version: 'v1',
    db_required: true,
    expected_columns: [
      'site_id',
      'stale_active_journal_rows',
      'malformed_external_id_rows',
      'contract_status',
      'blocking_reasons',
    ],
    red_green_criteria:
      'RED when stale active journal rows exceed age window or external_id shape drift (see docs/architecture/EXPORT_CLOSURE.md).',
  },
  {
    file: 'scripts/sql/export_closure_stage_journal_gap.sql',
    pack_id: 'export_closure_stage_journal_gap',
    contract_version: 'v1',
    db_required: true,
    expected_columns: ['site_id', 'stage_journal_gap_calls', 'contract_status', 'blocking_reasons'],
    red_green_criteria:
      'RED when G1 calls in lookback lack a journal row with matching canonical action (heuristic; see SQL header).',
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
    `- db_evidence_status: \`${artifact.metadata.db_evidence_status ?? 'unknown'}\``,
    `- static_queue_contract_green: \`${artifact.metadata.static_queue_contract_green ?? 'unknown'}\``,
    `- export_run_integrity: \`${artifact.metadata.export_run_integrity ?? 'unknown'}\``,
    `- export_run_lineage: \`${artifact.metadata.export_run_lineage ?? 'unknown'}\``,
    `- ack_db_transition_count_check: \`${artifact.metadata.ack_db_transition_count_check ?? 'unknown'}\``,
    `- script_summary_contract: \`${artifact.metadata.script_summary_contract ?? 'unknown'}\``,
    `- script_summary_reconciliation: \`${artifact.metadata.script_summary_reconciliation ?? 'unknown'}\``,
    `- script_summary_status: \`${artifact.metadata.script_summary_status ?? 'unknown'}\``,
    `- checked_equations: \`${artifact.metadata.checked_equations ?? 'unknown'}\``,
    `- missing_equations: \`${artifact.metadata.missing_equations ?? 'unknown'}\``,
    `- mismatch_reasons: \`${artifact.metadata.mismatch_reasons ?? 'unknown'}\``,
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
