import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProcessingRecovery } from '@/lib/oci/processing-recovery-classifier';

test('PR-4C: fresh PROCESSING row is NOT_STUCK_YET', () => {
  const decision = classifyProcessingRecovery({
    status: 'PROCESSING',
    nowIso: '2026-05-08T12:00:00.000Z',
    updatedAt: '2026-05-08T11:58:00.000Z',
    stuckThresholdMinutes: 15,
  });
  assert.equal(decision.recovery_bucket, 'NOT_STUCK_YET');
  assert.equal(decision.safe_to_retry, false);
});

test('PR-4C: stuck PROCESSING with no provider evidence is SAFE_TO_RETRY', () => {
  const decision = classifyProcessingRecovery({
    status: 'PROCESSING',
    nowIso: '2026-05-08T12:00:00.000Z',
    updatedAt: '2026-05-08T11:00:00.000Z',
    stuckThresholdMinutes: 15,
    hasScriptSummary: false,
    providerRequestId: null,
    exportRunId: null,
    scriptUploadAttemptedCount: 0,
  });
  assert.equal(decision.provider_outcome, 'SCRIPT_CRASHED_BEFORE_UPLOAD');
  assert.equal(decision.recovery_bucket, 'SAFE_TO_RETRY');
  assert.equal(decision.safe_to_retry, true);
});

test('PR-4C: stuck PROCESSING with provider_request_id is HOLD_FOR_PROVIDER_RECONCILIATION', () => {
  const decision = classifyProcessingRecovery({
    status: 'PROCESSING',
    nowIso: '2026-05-08T12:00:00.000Z',
    updatedAt: '2026-05-08T11:00:00.000Z',
    stuckThresholdMinutes: 15,
    providerRequestId: 'req-123',
  });
  assert.equal(decision.provider_outcome, 'PROVIDER_AMBIGUOUS_PENDING');
  assert.equal(decision.recovery_bucket, 'HOLD_FOR_PROVIDER_RECONCILIATION');
  assert.equal(decision.safe_to_retry, false);
});

test('PR-4C: stuck PROCESSING with upload_attempted > ACK totals is HOLD_FOR_PROVIDER_RECONCILIATION', () => {
  const decision = classifyProcessingRecovery({
    status: 'PROCESSING',
    nowIso: '2026-05-08T12:00:00.000Z',
    updatedAt: '2026-05-08T11:00:00.000Z',
    stuckThresholdMinutes: 15,
    hasScriptSummary: true,
    scriptUploadAttemptedCount: 3,
    scriptAckSuccessCount: 1,
    scriptAckFailedCount: 1,
  });
  assert.equal(decision.provider_outcome, 'ACK_ENDPOINT_UNAVAILABLE_AFTER_UPLOAD');
  assert.equal(decision.recovery_bucket, 'HOLD_FOR_PROVIDER_RECONCILIATION');
  assert.equal(decision.safe_to_retry, false);
});

test('PR-4C: stuck PROCESSING with export_run_id but missing summary is NEEDS_OPERATOR_REVIEW', () => {
  const decision = classifyProcessingRecovery({
    status: 'PROCESSING',
    nowIso: '2026-05-08T12:00:00.000Z',
    updatedAt: '2026-05-08T11:00:00.000Z',
    stuckThresholdMinutes: 15,
    hasScriptSummary: false,
    exportRunId: 'run-1',
  });
  assert.equal(decision.provider_outcome, 'SCRIPT_SUMMARY_MISSING');
  assert.equal(decision.recovery_bucket, 'NEEDS_OPERATOR_REVIEW');
  assert.equal(decision.safe_to_retry, false);
});

test('PR-4C: retry_count over cap becomes DEAD_LETTER_QUARANTINE', () => {
  const decision = classifyProcessingRecovery({
    status: 'PROCESSING',
    nowIso: '2026-05-08T12:00:00.000Z',
    updatedAt: '2026-05-08T11:00:00.000Z',
    stuckThresholdMinutes: 15,
    retryCount: 9,
    maxRetryCount: 7,
  });
  assert.equal(decision.recovery_bucket, 'DEAD_LETTER_QUARANTINE');
  assert.equal(decision.safe_to_retry, false);
});

test('PR-4C: unknown provider outcome is UNKNOWN_STUCK_PROCESSING and not safe', () => {
  const decision = classifyProcessingRecovery({
    status: 'PROCESSING',
    nowIso: '2026-05-08T12:00:00.000Z',
    updatedAt: '2026-05-08T11:00:00.000Z',
    stuckThresholdMinutes: 15,
    hasScriptSummary: true,
    scriptUploadAttemptedCount: 0,
    scriptAckSuccessCount: 0,
    scriptAckFailedCount: 0,
    exportRunId: null,
    providerRequestId: null,
  });
  assert.equal(decision.provider_outcome, 'UNKNOWN_PROVIDER_OUTCOME');
  assert.equal(decision.recovery_bucket, 'UNKNOWN_STUCK_PROCESSING');
  assert.equal(decision.safe_to_retry, false);
});

test('PR-4C: non-PROCESSING rows are NOT_APPLICABLE', () => {
  const decision = classifyProcessingRecovery({
    status: 'RETRY',
    nowIso: '2026-05-08T12:00:00.000Z',
  });
  assert.equal(decision.recovery_bucket, 'NOT_APPLICABLE');
  assert.equal(decision.safe_to_retry, false);
});

test('PR-4C: provider ambiguous outcome is never safe_to_retry', () => {
  const decision = classifyProcessingRecovery({
    status: 'PROCESSING',
    nowIso: '2026-05-08T12:00:00.000Z',
    updatedAt: '2026-05-08T11:00:00.000Z',
    providerRequestId: 'req-ambiguous',
  });
  assert.equal(decision.provider_outcome, 'PROVIDER_AMBIGUOUS_PENDING');
  assert.equal(decision.safe_to_retry, false);
});

test('PR-4C: ACK endpoint unavailable after upload is never safe_to_retry', () => {
  const decision = classifyProcessingRecovery({
    status: 'PROCESSING',
    nowIso: '2026-05-08T12:00:00.000Z',
    updatedAt: '2026-05-08T11:00:00.000Z',
    hasScriptSummary: true,
    scriptUploadAttemptedCount: 4,
    scriptAckSuccessCount: 2,
    scriptAckFailedCount: 1,
  });
  assert.equal(decision.provider_outcome, 'ACK_ENDPOINT_UNAVAILABLE_AFTER_UPLOAD');
  assert.equal(decision.safe_to_retry, false);
});
