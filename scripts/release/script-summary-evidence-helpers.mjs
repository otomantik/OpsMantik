/**
 * PR-9H.7F / PR-9H.7G — Derive release-evidence metadata from export_run_summary_health row + optional target lookup.
 */

import { evaluatePersistedSummaryEquations } from './script-summary-target-equations.mjs';

export function deriveScriptSummaryEvidenceFields(input) {
  const health = input.healthRow || {};
  const persistence = String(health.script_summary_persistence ?? '').trim();
  const mismatchCt = Number(health.script_summary_mismatch_count ?? 0) || 0;
  const reconciledCt = Number(health.reconciled_row_count ?? 0) || 0;
  const latestAt = health.latest_received_at ?? null;

  let script_summary_persistence = 'SCRIPT_SUMMARY_PERSISTENCE_MISSING';
  if (persistence === 'SCRIPT_SUMMARY_PERSISTENCE_PRESENT') {
    script_summary_persistence = 'SCRIPT_SUMMARY_PERSISTENCE_PRESENT';
  }

  let script_summary_status = 'SCRIPT_SUMMARY_MISSING';
  if (script_summary_persistence === 'SCRIPT_SUMMARY_PERSISTENCE_PRESENT') {
    if (mismatchCt > 0) script_summary_status = 'SCRIPT_SUMMARY_MISMATCH';
    else script_summary_status = 'SCRIPT_SUMMARY_PRESENT';
  }

  let script_summary_reconciliation = 'SCRIPT_SUMMARY_RECONCILIATION_UNVERIFIED';
  if (script_summary_persistence === 'SCRIPT_SUMMARY_PERSISTENCE_PRESENT') {
    if (mismatchCt > 0) script_summary_reconciliation = 'SCRIPT_SUMMARY_RECONCILIATION_MISMATCH';
    else if (reconciledCt > 0) script_summary_reconciliation = 'SCRIPT_SUMMARY_RECONCILIATION_VERIFIED';
    else script_summary_reconciliation = 'SCRIPT_SUMMARY_RECONCILIATION_PARTIAL';
  }

  const target = input.targetRow;
  /** @type {{ checked_equations?: string; missing_equations?: string; equation_mismatch_reasons?: string[] } | null} */
  let equationMeta = null;
  let oci_evidence_target_found = false;
  let oci_evidence_target_status = null;
  /** Count-only echo — never payload_redacted */
  let oci_evidence_target_counts = null;

  if (target && typeof target === 'object') {
    oci_evidence_target_found = true;
    oci_evidence_target_status = target.status ?? null;
    oci_evidence_target_counts = {
      fetched_count: Number(target.fetched_count ?? 0),
      claimed_count: Number(target.claimed_count ?? 0),
      classified_uploadable_count: Number(target.classified_uploadable_count ?? 0),
      classified_skipped_count: Number(target.classified_skipped_count ?? 0),
      classified_failed_count: Number(target.classified_failed_count ?? 0),
      upload_attempted_count: Number(target.upload_attempted_count ?? 0),
      upload_success_count: Number(target.upload_success_count ?? 0),
      upload_failed_count: Number(target.upload_failed_count ?? 0),
      ack_success_count: Number(target.ack_success_count ?? 0),
      ack_failed_count: Number(target.ack_failed_count ?? 0),
      ack_skipped_count: Number(target.ack_skipped_count ?? 0),
      provider_ambiguous_pending_count: Number(target.provider_ambiguous_pending_count ?? 0),
      hashed_phone_csv_canary_active: target.hashed_phone_csv_canary_active === true,
      mismatch_reasons: Array.isArray(target.mismatch_reasons) ? target.mismatch_reasons : [],
    };
    if (target.status === 'SCRIPT_SUMMARY_MISMATCH') {
      script_summary_status = 'SCRIPT_SUMMARY_MISMATCH';
    }

    const ev = evaluatePersistedSummaryEquations(target);
    equationMeta = {
      checked_equations: ev.checked_equations,
      missing_equations: ev.missing_equations,
      equation_mismatch_reasons: ev.mismatch_reasons,
    };
    if (ev.script_summary_reconciliation === 'SCRIPT_SUMMARY_RECONCILIATION_GREEN') {
      script_summary_reconciliation = 'SCRIPT_SUMMARY_RECONCILIATION_GREEN';
    } else if (ev.script_summary_reconciliation === 'SCRIPT_SUMMARY_RECONCILIATION_MISMATCH') {
      script_summary_reconciliation = 'SCRIPT_SUMMARY_RECONCILIATION_MISMATCH';
    }
  }

  return {
    script_summary_persistence,
    script_summary_status,
    script_summary_latest_received_at: latestAt,
    script_summary_reconciliation,
    script_summary_mismatch_count: mismatchCt,
    oci_evidence_target_found,
    oci_evidence_target_status,
    oci_evidence_target_counts,
    checked_equations: equationMeta?.checked_equations ?? null,
    missing_equations: equationMeta?.missing_equations ?? null,
    equation_mismatch_reasons: equationMeta?.equation_mismatch_reasons ?? [],
  };
}
