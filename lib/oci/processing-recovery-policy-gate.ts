export type ProcessingRecoveryEnvironmentMode = 'static' | 'local' | 'staging' | 'production';
export type ProcessingRecoveryClassifierMode = 'off' | 'shadow' | 'enforce_safe_retry' | 'strict';

export type ProcessingRecoveryGateInput = {
  mode: ProcessingRecoveryEnvironmentMode;
  strict: boolean;
  recoveryMode: ProcessingRecoveryClassifierMode;
  classifierPresent: boolean;
  rowScopedRpcPresent?: boolean;
  safeRetryCandidateCount?: number;
  providerAmbiguousCount?: number;
  requiresReviewCount?: number;
  unknownProviderOutcomeCount?: number;
  enforcementBypassCount?: number;
  classifierShadowCount?: number;
  classifierEnforcedCount?: number;
  waiver?: {
    owner?: string;
    reason?: string;
    expiry?: string;
    blastRadius?: string;
  };
};

export type ProcessingRecoveryGateDecision = {
  pass: boolean;
  recovery_integrity:
    | 'RECOVERY_INTEGRITY_UNVERIFIED'
    | 'RECOVERY_INTEGRITY_PARTIAL'
    | 'RECOVERY_INTEGRITY_RED'
    | 'RECOVERY_INTEGRITY_GREEN';
  blocking_reasons: string[];
  warnings: string[];
  waiver_required: boolean;
  waiver_accepted: boolean;
  strict_mode: boolean;
};

function readCount(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.trunc(value as number));
}

function isWaiverComplete(input: ProcessingRecoveryGateInput): boolean {
  const waiver = input.waiver;
  if (!waiver) return false;
  return Boolean(waiver.owner && waiver.reason && waiver.expiry && waiver.blastRadius);
}

function isWaiverExpired(input: ProcessingRecoveryGateInput): boolean {
  const expiry = input.waiver?.expiry;
  if (!expiry) return true;
  const dt = new Date(expiry);
  if (Number.isNaN(dt.getTime())) return true;
  return dt.getTime() < Date.now();
}

function recoveryIntegrityFromShape(input: ProcessingRecoveryGateInput): ProcessingRecoveryGateDecision['recovery_integrity'] {
  if (!input.classifierPresent) return 'RECOVERY_INTEGRITY_RED';
  if (input.mode === 'static' || input.mode === 'local') return 'RECOVERY_INTEGRITY_UNVERIFIED';
  if (input.recoveryMode === 'off' || input.recoveryMode === 'shadow') return 'RECOVERY_INTEGRITY_PARTIAL';
  return 'RECOVERY_INTEGRITY_PARTIAL';
}

export function evaluateProcessingRecoveryGate(
  input: ProcessingRecoveryGateInput
): ProcessingRecoveryGateDecision {
  const blocking_reasons: string[] = [];
  const warnings: string[] = [];
  const strict_mode = input.strict === true;
  const ambiguous = readCount(input.providerAmbiguousCount);
  const requiresReview = readCount(input.requiresReviewCount);
  const unknown = readCount(input.unknownProviderOutcomeCount);
  const bypass = readCount(input.enforcementBypassCount);
  const enforcementMode = input.recoveryMode === 'enforce_safe_retry' || input.recoveryMode === 'strict';
  const rowScopedPresent = input.rowScopedRpcPresent === true;

  let waiver_required = false;
  let waiver_accepted = false;
  let recovery_integrity = recoveryIntegrityFromShape(input);

  if (!input.classifierPresent) {
    blocking_reasons.push('RECOVERY_CLASSIFIER_MISSING');
    recovery_integrity = 'RECOVERY_INTEGRITY_RED';
  }

  if (enforcementMode && !rowScopedPresent) {
    blocking_reasons.push('RECOVERY_ROW_SCOPED_RPC_MISSING');
  }
  if (enforcementMode && bypass > 0) {
    blocking_reasons.push('RECOVERY_ENFORCEMENT_BYPASSED');
  }
  if (ambiguous > 0) {
    blocking_reasons.push('PROVIDER_AMBIGUOUS_REVIEW_REQUIRED');
  }
  if (unknown > 0) {
    blocking_reasons.push('UNKNOWN_PROVIDER_OUTCOME_PRESENT');
  }
  if (requiresReview > 0) {
    blocking_reasons.push('PROCESSING_REQUIRES_REVIEW_PRESENT');
  }

  if (!strict_mode || input.mode === 'static' || input.mode === 'local') {
    if (blocking_reasons.length > 0) {
      warnings.push(`Recovery integrity blockers observed: ${blocking_reasons.join(', ')}`);
    }
    if (recovery_integrity === 'RECOVERY_INTEGRITY_RED') {
      recovery_integrity = input.classifierPresent
        ? 'RECOVERY_INTEGRITY_PARTIAL'
        : 'RECOVERY_INTEGRITY_UNVERIFIED';
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

  // strict staging/production
  const hardRedReasons = blocking_reasons.filter((reason) =>
    ['RECOVERY_CLASSIFIER_MISSING', 'PROVIDER_AMBIGUOUS_REVIEW_REQUIRED', 'UNKNOWN_PROVIDER_OUTCOME_PRESENT'].includes(reason)
  );
  if (hardRedReasons.length > 0) {
    recovery_integrity = 'RECOVERY_INTEGRITY_RED';
    return {
      pass: false,
      recovery_integrity,
      blocking_reasons,
      warnings,
      waiver_required: false,
      waiver_accepted: false,
      strict_mode,
    };
  }

  const softReasons = blocking_reasons.filter((reason) =>
    ['PROCESSING_REQUIRES_REVIEW_PRESENT', 'RECOVERY_ENFORCEMENT_BYPASSED', 'RECOVERY_ROW_SCOPED_RPC_MISSING'].includes(reason)
  );
  if (softReasons.length > 0) {
    waiver_required = true;
    if (!isWaiverComplete(input)) {
      return {
        pass: false,
        recovery_integrity: 'RECOVERY_INTEGRITY_PARTIAL',
        blocking_reasons,
        warnings: [...warnings, 'Strict mode requires complete waiver metadata'],
        waiver_required,
        waiver_accepted: false,
        strict_mode,
      };
    }
    if (isWaiverExpired(input)) {
      return {
        pass: false,
        recovery_integrity: 'RECOVERY_INTEGRITY_PARTIAL',
        blocking_reasons,
        warnings: [...warnings, 'Waiver is expired or has invalid expiry'],
        waiver_required,
        waiver_accepted: false,
        strict_mode,
      };
    }
    waiver_accepted = true;
    recovery_integrity = 'RECOVERY_INTEGRITY_PARTIAL';
    warnings.push(`Recovery integrity waiver accepted for: ${softReasons.join(', ')}`);
    return {
      pass: true,
      recovery_integrity,
      blocking_reasons,
      warnings,
      waiver_required,
      waiver_accepted,
      strict_mode,
    };
  }

  recovery_integrity = 'RECOVERY_INTEGRITY_GREEN';
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
