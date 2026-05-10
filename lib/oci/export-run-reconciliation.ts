export interface ScriptSummaryPayload {
  export_run_id?: string;
  script_instance_id?: string;
  provider_key?: string;
  generated_at?: string;

  fetched_count?: number;
  claimed_count?: number;

  classified_uploadable_count: number;
  classified_skipped_count: number;
  classified_failed_count: number;

  upload_attempted_count: number;
  upload_success_count?: number;
  upload_failed_count?: number;
  provider_ambiguous_pending_count?: number;

  ack_success_count?: number;
  ack_failed_count?: number;
  ack_skipped_count?: number;

  skipped_reasons?: Record<string, number>;
  failed_reasons?: Record<string, number>;

  external_id_count?: number;
  external_id_hash?: string;

  summary_version: string;
}

export type ReconciliationStatus = 'RECONCILED' | 'MISMATCH' | 'INSUFFICIENT_EVIDENCE' | 'NOT_PROVIDED';
export type MismatchReason = 
  | 'SCRIPT_CLASSIFICATION_MISMATCH'
  | 'ACK_TOTAL_MISMATCH'
  | 'SCRIPT_SUMMARY_INVALID'
  | 'EXPORT_RUN_ID_MISSING'
  | 'CLAIMED_COUNT_MISSING'
  | 'ACK_COUNTS_MISSING';

export type ExportRunIntegrityStatus = 
  | 'STATIC_EXPORT_CONTRACT_GREEN'
  | 'EXPORT_RUN_INTEGRITY_UNVERIFIED'
  | 'EXPORT_RUN_INTEGRITY_PARTIAL'
  | 'EXPORT_RUN_INTEGRITY_RED'
  | 'EXPORT_RUN_INTEGRITY_GREEN';

export interface ReconciliationResult {
  ok: boolean;
  export_run_integrity: ExportRunIntegrityStatus;
  script_summary_status: string;
  reconciliation_status: ReconciliationStatus;
  mismatch_reasons?: MismatchReason[];
  checked_equations: string[];
  missing_equations: string[];
  details?: Record<string, unknown>;
}

export function validateScriptSummaryShape(payload: unknown): { ok: boolean; summary?: ScriptSummaryPayload; error?: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Payload must be an object' };
  }
  const body = payload as Record<string, unknown>;

  if (typeof body.summary_version !== 'string') return { ok: false, error: 'Missing or invalid summary_version' };
  if (typeof body.export_run_id !== 'string' || !String(body.export_run_id).trim()) {
    return { ok: false, error: 'Missing or invalid export_run_id' };
  }
  
  const requiredInts = [
    'classified_uploadable_count',
    'classified_skipped_count',
    'classified_failed_count',
    'upload_attempted_count',
  ];

  function isFiniteIntegerLike(n: unknown): boolean {
    return typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n;
  }

  for (const field of requiredInts) {
    if (!isFiniteIntegerLike(body[field])) {
      return { ok: false, error: `Missing or invalid required integer field: ${field}` };
    }
  }

  // Validate optional ints (negatives clamped at persist time — PR-9H.7F)
  const optionalInts = [
    'fetched_count',
    'claimed_count',
    'upload_success_count',
    'upload_failed_count',
    'provider_ambiguous_pending_count',
    'ack_success_count',
    'ack_failed_count',
    'ack_skipped_count',
    'external_id_count',
  ];

  for (const field of optionalInts) {
    if (body[field] !== undefined) {
      if (!isFiniteIntegerLike(body[field])) {
        return { ok: false, error: `Invalid optional integer field: ${field}` };
      }
    }
  }

  return { ok: true, summary: body as unknown as ScriptSummaryPayload };
}

export function evaluateReconciliation(summary: ScriptSummaryPayload): ReconciliationResult {
  const mismatchReasons: MismatchReason[] = [];
  const checkedEquations: string[] = [];
  const missingEquations: string[] = [];
  let hasInsufficientEvidence = false;

  // Equation B: claimed_count === classified_uploadable_count + classified_skipped_count + classified_failed_count
  if (summary.claimed_count !== undefined) {
    const totalClassified = summary.classified_uploadable_count + summary.classified_skipped_count + summary.classified_failed_count;
    if (summary.claimed_count !== totalClassified) {
      mismatchReasons.push('SCRIPT_CLASSIFICATION_MISMATCH');
    }
    checkedEquations.push('B');
  } else {
    mismatchReasons.push('CLAIMED_COUNT_MISSING');
    missingEquations.push('B');
    hasInsufficientEvidence = true;
  }

  // Equation C: upload_attempted_count === ack_success_count + ack_failed_count + provider_ambiguous_pending_count
  if (summary.ack_success_count !== undefined && summary.ack_failed_count !== undefined) {
    const ambiguousCount = summary.provider_ambiguous_pending_count ?? 0;
    const totalAck = summary.ack_success_count + summary.ack_failed_count + ambiguousCount;
    if (summary.upload_attempted_count !== totalAck) {
      mismatchReasons.push('ACK_TOTAL_MISMATCH');
    }
    checkedEquations.push('C');
  } else {
    mismatchReasons.push('ACK_COUNTS_MISSING');
    missingEquations.push('C');
    hasInsufficientEvidence = true;
  }

  if (mismatchReasons.length > 0) {
    if (hasInsufficientEvidence && mismatchReasons.every(r => r === 'CLAIMED_COUNT_MISSING' || r === 'ACK_COUNTS_MISSING')) {
      return {
        ok: true,
        export_run_integrity: checkedEquations.length > 0 ? 'EXPORT_RUN_INTEGRITY_PARTIAL' : 'EXPORT_RUN_INTEGRITY_UNVERIFIED',
        script_summary_status: 'SCRIPT_SUMMARY_RECEIVED',
        reconciliation_status: 'INSUFFICIENT_EVIDENCE',
        mismatch_reasons: mismatchReasons,
        checked_equations: checkedEquations,
        missing_equations: missingEquations
      };
    }
    return {
      ok: false,
      export_run_integrity: 'EXPORT_RUN_INTEGRITY_RED',
      script_summary_status: 'SCRIPT_SUMMARY_RECEIVED',
      reconciliation_status: 'MISMATCH',
      mismatch_reasons: mismatchReasons,
      checked_equations: checkedEquations,
      missing_equations: missingEquations
    };
  }

  return {
    ok: true,
    export_run_integrity: 'EXPORT_RUN_INTEGRITY_PARTIAL', // Eq D and runtime proofs not checked here
    script_summary_status: 'SCRIPT_SUMMARY_RECEIVED',
    reconciliation_status: 'RECONCILED',
    checked_equations: checkedEquations,
    missing_equations: missingEquations
  };
}
