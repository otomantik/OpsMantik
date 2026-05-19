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
  DB_ENV_MISSING: 'DB_ENV_MISSING',
  DB_SCHEMA_DRIFT: 'DB_SCHEMA_DRIFT',
  DB_GRANT_DRIFT: 'DB_GRANT_DRIFT',
  DB_RPC_MISSING: 'DB_RPC_MISSING',
  DB_RPC_SIGNATURE_DRIFT: 'DB_RPC_SIGNATURE_DRIFT',
  DB_UNSAFE_GRANT: 'DB_UNSAFE_GRANT',
  DB_SMOKE_FAILED: 'DB_SMOKE_FAILED',
  DB_URL_INVALID: 'DB_URL_INVALID',
  DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
  STALE_ARTIFACT_PREVENTED: 'STALE_ARTIFACT_PREVENTED',
  SCRIPT_SUMMARY_TARGET_MISSING: 'SCRIPT_SUMMARY_TARGET_MISSING',
  OCI_EVIDENCE_INCOMPLETE_TARGET_ENV: 'OCI_EVIDENCE_INCOMPLETE_TARGET_ENV',
  OCI_EVIDENCE_QUEUE_TARGET_MISSING: 'OCI_EVIDENCE_QUEUE_TARGET_MISSING',
  OCI_EVIDENCE_QUEUE_NOT_TERMINAL: 'OCI_EVIDENCE_QUEUE_NOT_TERMINAL',
  /** PR-9J.CI-AUDIT-P1.1 — rollout strict smoke triage (narrower than generic RED_METRIC) */
  OCI_ROLLOUT_GATE_RETRY_RATE: 'OCI_ROLLOUT_GATE_RETRY_RATE',
  OCI_ROLLOUT_GATE_STUCK_PROCESSING: 'OCI_ROLLOUT_GATE_STUCK_PROCESSING',
  OCI_ROLLOUT_GATE_ACTIONABLE_FAILED_RATE: 'OCI_ROLLOUT_GATE_ACTIONABLE_FAILED_RATE',
  OCI_ROLLOUT_GATE_PROVIDER_FAILED_RATE: 'OCI_ROLLOUT_GATE_PROVIDER_FAILED_RATE',
  OCI_ROLLOUT_GATE_UNKNOWN_FAILED: 'OCI_ROLLOUT_GATE_UNKNOWN_FAILED',
  OCI_ROLLOUT_GATE_WON_PIPELINE_LEAK: 'OCI_ROLLOUT_GATE_WON_PIPELINE_LEAK',
  OCI_ROLLOUT_GATE_DLQ: 'OCI_ROLLOUT_GATE_DLQ',
  OCI_ROLLOUT_GATE_FLEET_OTHER: 'OCI_ROLLOUT_GATE_FLEET_OTHER',
};

export const TARGET_DB_STATUSES = {
  TARGET_DB_GREEN: 'TARGET_DB_GREEN',
  TARGET_DB_RED: 'TARGET_DB_RED',
  TARGET_DB_PARTIAL: 'TARGET_DB_PARTIAL',
  TARGET_DB_UNVERIFIED: 'TARGET_DB_UNVERIFIED',
  LEGACY_RESIDUE_ABSENT: 'LEGACY_RESIDUE_ABSENT',
  AUDIT_TABLE_NOT_PRESENT: 'AUDIT_TABLE_NOT_PRESENT',
  OPTIONAL_LEGACY_CHECK_SKIPPED: 'OPTIONAL_LEGACY_CHECK_SKIPPED',
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
    contract_version: 'v2',
    db_required: true,
    expected_columns: [
      'site_id',
      'won_represented_active_count',
      'won_represented_completed_count',
      'won_represented_failed_terminal_count',
      'won_pipeline_represented_total',
      'won_missing_unrepresented_count',
      'won_missing_pipeline_count',
      'won_missing_pipeline',
      'leak_rate',
      'oldest_missing_won_age_seconds',
    ],
    red_green_criteria: 'RED when won_missing_unrepresented_count > 0.',
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
      'site_name',
      'offline_queue_active_count',
      'oldest_queued_at',
      'oldest_queued_age_seconds',
      'oldest_processing_at',
      'oldest_processing_age_seconds',
      'processing_with_provider_request_id_count',
      'retry_count',
    ],
    red_green_criteria:
      'RED when queue upload backlog ages breach SLO (oldest QUEUED/PROCESSING age).',
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
      'oldest_processing_age_minutes',
      'ambiguous_processing_count',
      'unknown_provider_outcome_count',
      'processing_with_provider_request_id_count',
      'processing_without_run_summary_count',
      'processing_safe_retry_candidate_count',
      'processing_requires_review_count',
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
  {
    file: 'scripts/sql/export_run_summary_health.sql',
    pack_id: 'export_run_summary_health',
    contract_version: 'v1',
    db_required: true,
    expected_columns: [
      'policy_version',
      'contract_status',
      'script_summary_persistence',
      'recent_summaries_30d',
      'latest_received_at',
      'empty_export_run_id_rows',
      'negative_count_violations',
      'duplicate_key_violations',
      'script_summary_mismatch_count',
      'reconciled_row_count',
    ],
    red_green_criteria:
      'RED when table missing or duplicate keys / negative counts / empty export_run_id rows; mismatch_count surfaces payload drift.',
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
    `- target_db_checked: \`${artifact.metadata.target_db_checked ?? false}\``,
    `- legacy_verify_db_checked: \`${artifact.metadata.legacy_verify_db_checked ?? false}\``,
    `- db_evidence_status: \`${artifact.metadata.db_evidence_status ?? 'unknown'}\``,
    `- target_db_contract_status: \`${artifact.metadata.target_db_contract_status ?? 'TARGET_DB_NOT_CHECKED'}\``,
    `- static_queue_contract_green: \`${artifact.metadata.static_queue_contract_green ?? 'unknown'}\``,
    `- export_run_integrity: \`${artifact.metadata.export_run_integrity ?? 'unknown'}\``,
    `- export_run_lineage: \`${artifact.metadata.export_run_lineage ?? 'unknown'}\``,
    `- ack_db_transition_count_check: \`${artifact.metadata.ack_db_transition_count_check ?? 'unknown'}\``,
    `- script_summary_contract: \`${artifact.metadata.script_summary_contract ?? 'unknown'}\``,
    `- script_summary_reconciliation: \`${artifact.metadata.script_summary_reconciliation ?? 'unknown'}\``,
    `- script_summary_status: \`${artifact.metadata.script_summary_status ?? 'unknown'}\``,
    `- export_run_integrity_gate_status: \`${artifact.metadata.export_run_integrity_gate?.status ?? 'unknown'}\``,
    `- recovery_integrity: \`${artifact.metadata.recovery_integrity ?? 'unknown'}\``,
    `- recovery_integrity_gate: \`${artifact.metadata.recovery_integrity_gate?.pass ? 'PASS' : 'FAIL'}\``,
    `- processing_recovery_mode: \`${artifact.metadata.processing_recovery_mode ?? 'unknown'}\``,
    `- classifier_present: \`${artifact.metadata.classifier_present ?? 'unknown'}\``,
    `- processing_classifier_enforcement_supported: \`${artifact.metadata.processing_classifier_enforcement_supported ?? 'unknown'}\``,
    `- row_scoped_recovery_rpc_present: \`${artifact.metadata.row_scoped_recovery_rpc_present ?? 'unknown'}\``,
    `- processing_classifier_bypass_count: \`${artifact.metadata.recovery_signals?.processing_classifier_bypass_count ?? 0}\``,
    `- recovery_blocking_reasons: \`${(artifact.metadata.recovery_integrity_gate?.blocking_reasons || []).join(',') || 'none'}\``,
    `- recovery_classifier_shadow: \`${artifact.metadata.recovery_classifier_shadow_present ?? 'unknown'}\``,
    `- recovery_classifier_enforcement: \`${artifact.metadata.recovery_classifier_enforcement_present ?? 'unknown'}\``,
    `- stuck_processing_signal: \`${artifact.metadata.stuck_processing_present ?? 'unknown'}\``,
    `- processing_recovery_policy: \`${artifact.metadata.processing_recovery_policy ?? 'unknown'}\``,
    `- provider_ambiguous_policy: \`${artifact.metadata.provider_ambiguous_review_required ?? 'unknown'}\``,
    `- duplicate_upload_risk: \`${artifact.metadata.duplicate_upload_risk_visible ?? 'unknown'}\``,
    `- strict_mode: \`${artifact.metadata.strict_mode ?? false}\``,
    `- waiver_status: \`${artifact.metadata.waiver_status ?? 'unknown'}\``,
    `- recovery_waiver_status: \`${artifact.metadata.recovery_waiver_status ?? 'unknown'}\``,
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

/** Map rollout triage primary class → evidence reason code (PR-9J). */
export function mapRolloutPrimaryClassToReasonCode(pc) {
  switch (pc) {
    case 'RED_METRIC_RETRY_RATE_HIGH':
      return REASON_CODES.OCI_ROLLOUT_GATE_RETRY_RATE;
    case 'RED_METRIC_STUCK_PROCESSING':
      return REASON_CODES.OCI_ROLLOUT_GATE_STUCK_PROCESSING;
    case 'RED_METRIC_ACTIONABLE_REAL':
      return REASON_CODES.OCI_ROLLOUT_GATE_ACTIONABLE_FAILED_RATE;
    case 'RED_METRIC_PROVIDER_RISK':
      return REASON_CODES.OCI_ROLLOUT_GATE_PROVIDER_FAILED_RATE;
    case 'RED_METRIC_UNKNOWN_FAILED':
      return REASON_CODES.OCI_ROLLOUT_GATE_UNKNOWN_FAILED;
    case 'RED_METRIC_WON_PIPELINE_LEAK':
      return REASON_CODES.OCI_ROLLOUT_GATE_WON_PIPELINE_LEAK;
    case 'RED_METRIC_DLQ_PRESENT':
      return REASON_CODES.OCI_ROLLOUT_GATE_DLQ;
    case 'RED_METRIC_SCHEMA_DRIFT':
      return REASON_CODES.DB_SCHEMA_DRIFT;
    default:
      return pc === 'RED_METRIC_UNKNOWN' ? REASON_CODES.RED_METRIC : REASON_CODES.OCI_ROLLOUT_GATE_FLEET_OTHER;
  }
}
