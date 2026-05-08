export type ProcessingRecoveryBucket =
  | 'NOT_APPLICABLE'
  | 'NOT_STUCK_YET'
  | 'SAFE_TO_RETRY'
  | 'HOLD_FOR_PROVIDER_RECONCILIATION'
  | 'NEEDS_OPERATOR_REVIEW'
  | 'DEAD_LETTER_QUARANTINE'
  | 'UNKNOWN_STUCK_PROCESSING';

export type ProcessingProviderOutcome =
  | 'PROVIDER_NOT_ATTEMPTED'
  | 'PROVIDER_UPLOAD_ATTEMPTED'
  | 'PROVIDER_ACCEPTED_ACKED'
  | 'PROVIDER_REJECTED_ACKED'
  | 'PROVIDER_AMBIGUOUS_PENDING'
  | 'ACK_ENDPOINT_UNAVAILABLE_AFTER_UPLOAD'
  | 'SCRIPT_CRASHED_BEFORE_UPLOAD'
  | 'SCRIPT_CRASHED_AFTER_UPLOAD'
  | 'SCRIPT_SUMMARY_MISSING'
  | 'UNKNOWN_PROVIDER_OUTCOME';

export type ProcessingRecoveryInput = {
  status: string;
  claimedAt?: string | null;
  updatedAt?: string | null;
  nowIso?: string;
  providerRequestId?: string | null;
  providerErrorCode?: string | null;
  providerErrorCategory?: string | null;
  exportRunId?: string | null;
  hasScriptSummary?: boolean;
  scriptUploadAttemptedCount?: number | null;
  scriptAckSuccessCount?: number | null;
  scriptAckFailedCount?: number | null;
  retryCount?: number | null;
  maxRetryCount?: number;
  stuckThresholdMinutes?: number;
};

export type ProcessingRecoveryDecision = {
  provider_outcome: ProcessingProviderOutcome;
  recovery_bucket: ProcessingRecoveryBucket;
  safe_to_retry: boolean;
  requires_operator_review: boolean;
  reason_code: string;
  blocking_reasons: string[];
  evidence: Record<string, unknown>;
};

const DEFAULT_STUCK_THRESHOLD_MINUTES = 15;
const DEFAULT_MAX_RETRY_COUNT = 7;

function asInt(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value as number));
}

function parseIso(value: string | null | undefined): number | null {
  if (!value || typeof value !== 'string') return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function buildDecision(input: {
  provider_outcome: ProcessingProviderOutcome;
  recovery_bucket: ProcessingRecoveryBucket;
  safe_to_retry: boolean;
  reason_code: string;
  blocking_reasons?: string[];
  evidence: Record<string, unknown>;
}): ProcessingRecoveryDecision {
  const hardUnsafeOutcomes: ProcessingProviderOutcome[] = [
    'PROVIDER_AMBIGUOUS_PENDING',
    'ACK_ENDPOINT_UNAVAILABLE_AFTER_UPLOAD',
    'SCRIPT_CRASHED_AFTER_UPLOAD',
    'UNKNOWN_PROVIDER_OUTCOME',
  ];
  const hardUnsafe = hardUnsafeOutcomes.includes(input.provider_outcome);
  const safe_to_retry = hardUnsafe ? false : input.safe_to_retry;
  const blocking = [...(input.blocking_reasons ?? [])];
  if (hardUnsafe && !blocking.includes('UNSAFE_PROVIDER_OUTCOME')) {
    blocking.push('UNSAFE_PROVIDER_OUTCOME');
  }
  return {
    provider_outcome: input.provider_outcome,
    recovery_bucket: input.recovery_bucket,
    safe_to_retry,
    requires_operator_review:
      input.recovery_bucket === 'HOLD_FOR_PROVIDER_RECONCILIATION' ||
      input.recovery_bucket === 'NEEDS_OPERATOR_REVIEW' ||
      input.recovery_bucket === 'UNKNOWN_STUCK_PROCESSING' ||
      input.recovery_bucket === 'DEAD_LETTER_QUARANTINE',
    reason_code: input.reason_code,
    blocking_reasons: blocking,
    evidence: input.evidence,
  };
}

export function classifyProcessingRecovery(input: ProcessingRecoveryInput): ProcessingRecoveryDecision {
  const status = (input.status ?? '').toUpperCase();
  const nowMs = parseIso(input.nowIso ?? null) ?? Date.now();
  const claimedMs = parseIso(input.claimedAt ?? null);
  const updatedMs = parseIso(input.updatedAt ?? null);
  const referenceMs = claimedMs ?? updatedMs;
  const stuckThresholdMinutes = Math.max(1, asInt(input.stuckThresholdMinutes ?? DEFAULT_STUCK_THRESHOLD_MINUTES));
  const maxRetryCount = Math.max(1, asInt(input.maxRetryCount ?? DEFAULT_MAX_RETRY_COUNT));
  const retryCount = asInt(input.retryCount);
  const uploadAttempted = asInt(input.scriptUploadAttemptedCount);
  const ackSuccess = asInt(input.scriptAckSuccessCount);
  const ackFailed = asInt(input.scriptAckFailedCount);
  const unresolvedAfterUpload = uploadAttempted > ackSuccess + ackFailed;
  const providerRequestIdPresent = Boolean(input.providerRequestId && String(input.providerRequestId).trim().length > 0);
  const exportRunIdPresent = Boolean(input.exportRunId && String(input.exportRunId).trim().length > 0);
  const hasSummary = input.hasScriptSummary === true;
  const ageMinutes = referenceMs == null ? null : Math.max(0, (nowMs - referenceMs) / 60000);
  const isStuck = ageMinutes != null && ageMinutes >= stuckThresholdMinutes;

  const evidence: Record<string, unknown> = {
    status,
    age_minutes: ageMinutes,
    stuck_threshold_minutes: stuckThresholdMinutes,
    provider_request_id_present: providerRequestIdPresent,
    export_run_id_present: exportRunIdPresent,
    has_script_summary: hasSummary,
    upload_attempted_count: uploadAttempted,
    ack_success_count: ackSuccess,
    ack_failed_count: ackFailed,
    retry_count: retryCount,
    max_retry_count: maxRetryCount,
  };

  if (status !== 'PROCESSING') {
    return buildDecision({
      provider_outcome: 'UNKNOWN_PROVIDER_OUTCOME',
      recovery_bucket: 'NOT_APPLICABLE',
      safe_to_retry: false,
      reason_code: 'NOT_PROCESSING_STATUS',
      evidence,
    });
  }

  if (isStuck !== true) {
    return buildDecision({
      provider_outcome: 'PROVIDER_NOT_ATTEMPTED',
      recovery_bucket: 'NOT_STUCK_YET',
      safe_to_retry: false,
      reason_code: ageMinutes == null ? 'AGE_EVIDENCE_MISSING' : 'PROCESSING_NOT_STUCK',
      evidence,
    });
  }

  if (retryCount >= maxRetryCount) {
    return buildDecision({
      provider_outcome: 'UNKNOWN_PROVIDER_OUTCOME',
      recovery_bucket: 'DEAD_LETTER_QUARANTINE',
      safe_to_retry: false,
      reason_code: 'MAX_RETRY_EXHAUSTED',
      blocking_reasons: ['MAX_RETRY_EXHAUSTED'],
      evidence,
    });
  }

  if (providerRequestIdPresent) {
    return buildDecision({
      provider_outcome: 'PROVIDER_AMBIGUOUS_PENDING',
      recovery_bucket: 'HOLD_FOR_PROVIDER_RECONCILIATION',
      safe_to_retry: false,
      reason_code: 'PROVIDER_REQUEST_ID_PRESENT',
      blocking_reasons: ['PROVIDER_UPLOAD_MAY_HAVE_HAPPENED'],
      evidence,
    });
  }

  if (hasSummary && unresolvedAfterUpload) {
    const ambiguousFromProvider =
      String(input.providerErrorCategory ?? '').toUpperCase() === 'PROVIDER_AMBIGUOUS' ||
      String(input.providerErrorCode ?? '').toUpperCase() === 'PROVIDER_AMBIGUOUS';
    return buildDecision({
      provider_outcome: ambiguousFromProvider
        ? 'PROVIDER_AMBIGUOUS_PENDING'
        : 'ACK_ENDPOINT_UNAVAILABLE_AFTER_UPLOAD',
      recovery_bucket: 'HOLD_FOR_PROVIDER_RECONCILIATION',
      safe_to_retry: false,
      reason_code: ambiguousFromProvider ? 'PROVIDER_AMBIGUOUS_PENDING' : 'UPLOAD_ATTEMPTED_ACK_GAP',
      blocking_reasons: ['UPLOAD_ATTEMPTED_WITHOUT_FULL_ACK'],
      evidence,
    });
  }

  if (!hasSummary && exportRunIdPresent) {
    return buildDecision({
      provider_outcome: 'SCRIPT_SUMMARY_MISSING',
      recovery_bucket: 'NEEDS_OPERATOR_REVIEW',
      safe_to_retry: false,
      reason_code: 'EXPORT_RUN_PRESENT_SCRIPT_SUMMARY_MISSING',
      blocking_reasons: ['SCRIPT_SUMMARY_MISSING'],
      evidence,
    });
  }

  const noUploadEvidence =
    !providerRequestIdPresent &&
    !hasSummary &&
    uploadAttempted === 0 &&
    !exportRunIdPresent;

  if (noUploadEvidence) {
    return buildDecision({
      provider_outcome: 'SCRIPT_CRASHED_BEFORE_UPLOAD',
      recovery_bucket: 'SAFE_TO_RETRY',
      safe_to_retry: true,
      reason_code: 'NO_PROVIDER_UPLOAD_EVIDENCE',
      evidence,
    });
  }

  return buildDecision({
    provider_outcome: 'UNKNOWN_PROVIDER_OUTCOME',
    recovery_bucket: 'UNKNOWN_STUCK_PROCESSING',
    safe_to_retry: false,
    reason_code: 'INSUFFICIENT_RECOVERY_EVIDENCE',
    blocking_reasons: ['UNKNOWN_PROVIDER_OUTCOME'],
    evidence,
  });
}
