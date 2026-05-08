import {
  classifyProcessingRecovery,
  type ProcessingRecoveryDecision,
  type ProcessingRecoveryInput,
} from '@/lib/oci/processing-recovery-classifier';

export type ProcessingRecoveryClassifierMode = 'off' | 'shadow' | 'enforce_safe_retry' | 'strict';

export type ProcessingRecoveryCandidateRow = {
  id: string;
  status: string;
  claimed_at?: string | null;
  updated_at?: string | null;
  provider_request_id?: string | null;
  provider_error_code?: string | null;
  provider_error_category?: string | null;
  retry_count?: number | null;
};

export type ProcessingRecoveryClassificationResult = {
  row_id: string;
  decision: ProcessingRecoveryDecision;
};

export type ProcessingRecoveryDecisionSummary = {
  total_candidates: number;
  processing_safe_retry_candidate_count: number;
  processing_provider_ambiguous_count: number;
  processing_requires_review_count: number;
  processing_unknown_provider_outcome_count: number;
  processing_classifier_shadow_count: number;
  processing_classifier_enforced_count: number;
  processing_classifier_bypass_count: number;
};

export const DEFAULT_PROCESSING_RECOVERY_CLASSIFIER_MODE: ProcessingRecoveryClassifierMode = 'off';

export function resolveProcessingRecoveryClassifierMode(
  value: string | undefined | null
): ProcessingRecoveryClassifierMode {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (
    normalized === 'off' ||
    normalized === 'shadow' ||
    normalized === 'enforce_safe_retry' ||
    normalized === 'strict'
  ) {
    return normalized;
  }
  return DEFAULT_PROCESSING_RECOVERY_CLASSIFIER_MODE;
}

export function mapRowToProcessingRecoveryInput(
  row: ProcessingRecoveryCandidateRow,
  nowIso: string,
  stuckThresholdMinutes: number
): ProcessingRecoveryInput {
  return {
    status: row.status,
    claimedAt: row.claimed_at ?? null,
    updatedAt: row.updated_at ?? null,
    nowIso,
    providerRequestId: row.provider_request_id ?? null,
    providerErrorCode: row.provider_error_code ?? null,
    providerErrorCategory: row.provider_error_category ?? null,
    exportRunId: null, // queue row does not currently persist export_run_id
    hasScriptSummary: false, // script summary is not row-scoped in current schema
    scriptUploadAttemptedCount: null,
    scriptAckSuccessCount: null,
    scriptAckFailedCount: null,
    retryCount: row.retry_count ?? null,
    stuckThresholdMinutes,
  };
}

export function classifyProcessingRecoveryRows(input: {
  rows: ProcessingRecoveryCandidateRow[];
  nowIso: string;
  stuckThresholdMinutes: number;
}): ProcessingRecoveryClassificationResult[] {
  return input.rows.map((row) => ({
    row_id: row.id,
    decision: classifyProcessingRecovery(
      mapRowToProcessingRecoveryInput(row, input.nowIso, input.stuckThresholdMinutes)
    ),
  }));
}

export function summarizeProcessingRecoveryDecisions(
  rows: ProcessingRecoveryClassificationResult[],
  mode: ProcessingRecoveryClassifierMode,
  options?: { enforcementSupported?: boolean }
): ProcessingRecoveryDecisionSummary {
  const safe = rows.filter((r) => r.decision.recovery_bucket === 'SAFE_TO_RETRY').length;
  const ambiguous = rows.filter((r) => r.decision.provider_outcome === 'PROVIDER_AMBIGUOUS_PENDING').length;
  const review = rows.filter((r) => r.decision.requires_operator_review).length;
  const unknown = rows.filter((r) => r.decision.provider_outcome === 'UNKNOWN_PROVIDER_OUTCOME').length;
  const shadow = mode === 'shadow' ? rows.length : 0;
  const enforcementSupported = options?.enforcementSupported === true;
  const enforcementMode = mode === 'enforce_safe_retry' || mode === 'strict';
  const enforced = enforcementMode && enforcementSupported ? safe : 0;
  const bypass = enforcementMode && !enforcementSupported ? rows.length : 0;
  return {
    total_candidates: rows.length,
    processing_safe_retry_candidate_count: safe,
    processing_provider_ambiguous_count: ambiguous,
    processing_requires_review_count: review,
    processing_unknown_provider_outcome_count: unknown,
    processing_classifier_shadow_count: shadow,
    processing_classifier_enforced_count: enforced,
    processing_classifier_bypass_count: bypass,
  };
}

export function pickSafeRetryRowIds(rows: ProcessingRecoveryClassificationResult[]): string[] {
  return rows
    .filter(
      (r) =>
        r.decision.safe_to_retry === true &&
        r.decision.recovery_bucket === 'SAFE_TO_RETRY'
    )
    .map((r) => r.row_id);
}
