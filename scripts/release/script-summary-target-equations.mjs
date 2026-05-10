/**
 * PR-9H.7G — Evaluate persisted oci_export_run_summaries counts for evidence metadata (no PII).
 * Aligns with lib/oci/export-run-summary-equations.ts payload checks.
 */

/**
 * @param {Record<string, unknown> | null | undefined} row — summary row from DB
 */
export function evaluatePersistedSummaryEquations(row) {
  if (!row || typeof row !== 'object') {
    return {
      all_green: false,
      checked_equations: 'NONE',
      missing_equations: 'ALL_RUNTIME_EQUATIONS',
      mismatch_reasons: [],
      partial_evidence: true,
      script_summary_reconciliation: 'SCRIPT_SUMMARY_RECONCILIATION_UNVERIFIED',
    };
  }

  const fc = row.fetched_count != null ? Number(row.fetched_count) : undefined;
  const claimed = Number(row.claimed_count ?? 0);
  const cu = Number(row.classified_uploadable_count ?? 0);
  const cs = Number(row.classified_skipped_count ?? 0);
  const cf = Number(row.classified_failed_count ?? 0);
  const ua = Number(row.upload_attempted_count ?? 0);
  const us = Number(row.upload_success_count ?? 0);
  const uf = Number(row.upload_failed_count ?? 0);
  const pap = Number(row.provider_ambiguous_pending_count ?? 0);
  const askOk = Number(row.ack_success_count ?? 0);
  const af = Number(row.ack_failed_count ?? 0);
  const ask = Number(row.ack_skipped_count ?? 0);

  const mismatch_reasons = [];
  let partial_evidence = false;
  const checked = [];

  if (fc !== undefined) {
    checked.push('A');
    if (fc !== claimed) mismatch_reasons.push('EQ_A_FETCHED_CLAIMED_MISMATCH');
  } else {
    partial_evidence = true;
  }

  checked.push('B');
  if (claimed !== cu + cs + cf) mismatch_reasons.push('EQ_B_CLASSIFICATION_MISMATCH');

  checked.push('C');
  if (ua !== us + uf + pap) mismatch_reasons.push('EQ_C_UPLOAD_MISMATCH');

  checked.push('D');
  if (askOk + af + ask > claimed) mismatch_reasons.push('EQ_D_ACK_TOTAL_EXCEEDS_CLAIMED');

  const all_green = mismatch_reasons.length === 0 && !partial_evidence;
  let script_summary_reconciliation = 'SCRIPT_SUMMARY_RECONCILIATION_UNVERIFIED';
  if (mismatch_reasons.length > 0) {
    script_summary_reconciliation = 'SCRIPT_SUMMARY_RECONCILIATION_MISMATCH';
  } else if (partial_evidence) {
    script_summary_reconciliation = 'SCRIPT_SUMMARY_RECONCILIATION_PARTIAL';
  } else {
    script_summary_reconciliation = 'SCRIPT_SUMMARY_RECONCILIATION_GREEN';
  }

  const st = String(row.status ?? '').trim();
  if (st === 'SCRIPT_SUMMARY_MISMATCH') {
    script_summary_reconciliation = 'SCRIPT_SUMMARY_RECONCILIATION_MISMATCH';
  }

  return {
    all_green,
    checked_equations: checked.sort().join(','),
    missing_equations: partial_evidence ? 'EQ_A_FETCHED_OPTIONAL' : 'NONE',
    mismatch_reasons,
    partial_evidence,
    script_summary_reconciliation,
  };
}
