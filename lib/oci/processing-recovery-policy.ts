import {
  classifyProcessingRecovery,
  type ProcessingProviderOutcome as ProviderOutcome,
  type ProcessingRecoveryBucket as RecoveryBucket,
  type ProcessingRecoveryDecision,
  type ProcessingRecoveryInput,
} from '@/lib/oci/processing-recovery-classifier';

export type ProcessingRecoveryEvidence = ProcessingRecoveryInput;
export type { ProcessingRecoveryDecision, RecoveryBucket, ProviderOutcome };

/**
 * Backward-compatible alias retained for PR-4A callers.
 * PR-4C canonical entrypoint: classifyProcessingRecovery().
 */
export function classifyStuckProcessingRow(input: ProcessingRecoveryInput): ProcessingRecoveryDecision {
  return classifyProcessingRecovery(input);
}
