/**
 * PR-9H.7F — Payload-only reconciliation for export-run-summary (no terminal queue proof).
 * Eq A–D are checked from summary integers only; Eq E is documentary (terminal state from queue/ledger).
 */

import type { ScriptSummaryPayload } from '@/lib/oci/export-run-reconciliation';

export type PersistSummaryStatus =
  | 'SCRIPT_SUMMARY_RECEIVED'
  | 'SCRIPT_SUMMARY_RECONCILED'
  | 'SCRIPT_SUMMARY_MISMATCH'
  | 'SCRIPT_SUMMARY_REJECTED';

export type PayloadEquationCode =
  | 'EQ_A_FETCHED_CLAIMED_MISMATCH'
  | 'EQ_B_CLASSIFICATION_MISMATCH'
  | 'EQ_C_UPLOAD_MISMATCH'
  | 'EQ_D_ACK_TOTAL_EXCEEDS_CLAIMED'
  | 'EQ_E_SELECTED_CLICK_SUM_MISMATCH'
  | 'EQ_F_CLASSIFIED_FAILED_DECOMP_MISMATCH'
  | 'EQ_G_HASHED_PHONE_ATTACHED_EXCEEDS_UPLOAD'
  | 'EQ_H_MULTIPLE_CLICK_IDS_EXCEEDS_UPLOADABLE';

export function normalizeNonNegativeInt(n: unknown, fallback = 0): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/** Normalize summary counts for persistence (invalid negatives clamped to 0). */
export function normalizeSummaryForPersist(summary: ScriptSummaryPayload): ScriptSummaryPayload {
  return {
    ...summary,
    fetched_count: summary.fetched_count !== undefined ? normalizeNonNegativeInt(summary.fetched_count) : undefined,
    claimed_count: normalizeNonNegativeInt(summary.claimed_count, 0),
    classified_uploadable_count: normalizeNonNegativeInt(summary.classified_uploadable_count),
    classified_skipped_count: normalizeNonNegativeInt(summary.classified_skipped_count),
    classified_failed_count: normalizeNonNegativeInt(summary.classified_failed_count),
    upload_attempted_count: normalizeNonNegativeInt(summary.upload_attempted_count),
    upload_success_count: normalizeNonNegativeInt(summary.upload_success_count, 0),
    upload_failed_count: normalizeNonNegativeInt(summary.upload_failed_count, 0),
    provider_ambiguous_pending_count: normalizeNonNegativeInt(summary.provider_ambiguous_pending_count, 0),
    ack_success_count: normalizeNonNegativeInt(summary.ack_success_count, 0),
    ack_failed_count: normalizeNonNegativeInt(summary.ack_failed_count, 0),
    ack_skipped_count: normalizeNonNegativeInt(summary.ack_skipped_count, 0),
    selected_gclid_count: normalizeNonNegativeInt(summary.selected_gclid_count, 0),
    selected_wbraid_count: normalizeNonNegativeInt(summary.selected_wbraid_count, 0),
    selected_gbraid_count: normalizeNonNegativeInt(summary.selected_gbraid_count, 0),
    multiple_click_ids_count: normalizeNonNegativeInt(summary.multiple_click_ids_count, 0),
    hashed_phone_attached_count: normalizeNonNegativeInt(summary.hashed_phone_attached_count, 0),
    hashed_phone_only_rejected_count: normalizeNonNegativeInt(summary.hashed_phone_only_rejected_count, 0),
    missing_click_id_count: normalizeNonNegativeInt(summary.missing_click_id_count, 0),
    invalid_time_count: normalizeNonNegativeInt(summary.invalid_time_count, 0),
    other_validation_failed_count: normalizeNonNegativeInt(summary.other_validation_failed_count, 0),
  };
}

export function evaluatePersistEquations(summary: ScriptSummaryPayload): {
  mismatch_reasons: PayloadEquationCode[];
  checked_a: boolean;
  checked_b: boolean;
  checked_c: boolean;
  checked_d: boolean;
  checked_e: boolean;
  checked_f: boolean;
  checked_g: boolean;
  checked_h: boolean;
  partial_evidence: boolean;
} {
  const mismatch_reasons: PayloadEquationCode[] = [];
  let checked_a = false;
  let checked_b = false;
  let checked_c = false;
  let checked_d = false;
  let checked_e = false;
  let checked_f = false;
  let checked_g = false;
  let checked_h = false;
  let partial_evidence = false;

  const fc = summary.fetched_count;
  const claimed = summary.claimed_count ?? 0;
  const cu = summary.classified_uploadable_count;
  const cs = summary.classified_skipped_count;
  const cf = summary.classified_failed_count;
  const ua = summary.upload_attempted_count;
  const us = summary.upload_success_count ?? 0;
  const uf = summary.upload_failed_count ?? 0;
  const pap = summary.provider_ambiguous_pending_count ?? 0;
  const asOk = summary.ack_success_count ?? 0;
  const af = summary.ack_failed_count ?? 0;
  const ask = summary.ack_skipped_count ?? 0;

  const sg = summary.selected_gclid_count ?? 0;
  const sw = summary.selected_wbraid_count ?? 0;
  const sgb = summary.selected_gbraid_count ?? 0;
  const multi = summary.multiple_click_ids_count ?? 0;
  const hpAtt = summary.hashed_phone_attached_count ?? 0;
  const hpOnly = summary.hashed_phone_only_rejected_count ?? 0;
  const missClick = summary.missing_click_id_count ?? 0;
  const invTime = summary.invalid_time_count ?? 0;
  const otherVal = summary.other_validation_failed_count ?? 0;

  // Eq A
  if (fc !== undefined) {
    checked_a = true;
    if (fc !== claimed) mismatch_reasons.push('EQ_A_FETCHED_CLAIMED_MISMATCH');
  } else {
    partial_evidence = true;
  }

  // Eq B
  checked_b = true;
  const classSum = cu + cs + cf;
  if (claimed !== classSum) mismatch_reasons.push('EQ_B_CLASSIFICATION_MISMATCH');

  // Eq C
  checked_c = true;
  const uploadSum = us + uf + pap;
  if (ua !== uploadSum) mismatch_reasons.push('EQ_C_UPLOAD_MISMATCH');

  // Eq D
  checked_d = true;
  const ackSum = asOk + af + ask;
  if (ackSum > claimed) mismatch_reasons.push('EQ_D_ACK_TOTAL_EXCEEDS_CLAIMED');

  // PR-9I optional equations when Script emits universal counter bundle
  const pr9iEmitted = typeof summary.selected_gclid_count === 'number';

  if (pr9iEmitted) {
    checked_e = true;
    if (ua !== sg + sw + sgb) mismatch_reasons.push('EQ_E_SELECTED_CLICK_SUM_MISMATCH');

    checked_f = true;
    const failSum = hpOnly + missClick + invTime + otherVal;
    if (cf !== failSum) mismatch_reasons.push('EQ_F_CLASSIFIED_FAILED_DECOMP_MISMATCH');

    checked_g = true;
    if (hpAtt > ua) mismatch_reasons.push('EQ_G_HASHED_PHONE_ATTACHED_EXCEEDS_UPLOAD');

    checked_h = true;
    if (multi > cu) mismatch_reasons.push('EQ_H_MULTIPLE_CLICK_IDS_EXCEEDS_UPLOADABLE');
  }

  return {
    mismatch_reasons,
    checked_a,
    checked_b,
    checked_c,
    checked_d,
    checked_e,
    checked_f,
    checked_g,
    checked_h,
    partial_evidence,
  };
}

export function derivePersistStatus(params: {
  shapeOk: boolean;
  mismatch_reasons: PayloadEquationCode[];
  partial_evidence: boolean;
}): PersistSummaryStatus {
  if (!params.shapeOk) return 'SCRIPT_SUMMARY_REJECTED';
  if (params.mismatch_reasons.length > 0) return 'SCRIPT_SUMMARY_MISMATCH';
  if (params.partial_evidence) return 'SCRIPT_SUMMARY_RECEIVED';
  return 'SCRIPT_SUMMARY_RECONCILED';
}
