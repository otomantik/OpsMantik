import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProcessingRecoveryGate } from '@/lib/oci/processing-recovery-policy-gate';

test('PR-4E: static mode passes with RECOVERY_INTEGRITY_UNVERIFIED', () => {
  const decision = evaluateProcessingRecoveryGate({
    mode: 'static',
    strict: false,
    recoveryMode: 'off',
    classifierPresent: true,
  });
  assert.equal(decision.pass, true);
  assert.equal(decision.recovery_integrity, 'RECOVERY_INTEGRITY_UNVERIFIED');
});

test('PR-4E: strict mode fails when classifier is missing', () => {
  const decision = evaluateProcessingRecoveryGate({
    mode: 'production',
    strict: true,
    recoveryMode: 'strict',
    classifierPresent: false,
    rowScopedRpcPresent: true,
  });
  assert.equal(decision.pass, false);
  assert.equal(decision.recovery_integrity, 'RECOVERY_INTEGRITY_RED');
  assert.ok(decision.blocking_reasons.includes('RECOVERY_CLASSIFIER_MISSING'));
});

test('PR-4E: strict mode fails when row-scoped RPC missing in enforce mode', () => {
  const decision = evaluateProcessingRecoveryGate({
    mode: 'staging',
    strict: true,
    recoveryMode: 'enforce_safe_retry',
    classifierPresent: true,
    rowScopedRpcPresent: false,
  });
  assert.equal(decision.pass, false);
  assert.ok(decision.blocking_reasons.includes('RECOVERY_ROW_SCOPED_RPC_MISSING'));
});

test('PR-4E: strict mode fails when providerAmbiguousCount > 0', () => {
  const decision = evaluateProcessingRecoveryGate({
    mode: 'production',
    strict: true,
    recoveryMode: 'strict',
    classifierPresent: true,
    rowScopedRpcPresent: true,
    providerAmbiguousCount: 1,
  });
  assert.equal(decision.pass, false);
  assert.equal(decision.recovery_integrity, 'RECOVERY_INTEGRITY_RED');
  assert.ok(decision.blocking_reasons.includes('PROVIDER_AMBIGUOUS_REVIEW_REQUIRED'));
});

test('PR-4E: strict mode fails when unknownProviderOutcomeCount > 0', () => {
  const decision = evaluateProcessingRecoveryGate({
    mode: 'production',
    strict: true,
    recoveryMode: 'strict',
    classifierPresent: true,
    rowScopedRpcPresent: true,
    unknownProviderOutcomeCount: 2,
  });
  assert.equal(decision.pass, false);
  assert.equal(decision.recovery_integrity, 'RECOVERY_INTEGRITY_RED');
  assert.ok(decision.blocking_reasons.includes('UNKNOWN_PROVIDER_OUTCOME_PRESENT'));
});

test('PR-4E: strict mode fails when enforcementBypassCount > 0', () => {
  const decision = evaluateProcessingRecoveryGate({
    mode: 'staging',
    strict: true,
    recoveryMode: 'strict',
    classifierPresent: true,
    rowScopedRpcPresent: true,
    enforcementBypassCount: 1,
  });
  assert.equal(decision.pass, false);
  assert.equal(decision.recovery_integrity, 'RECOVERY_INTEGRITY_PARTIAL');
  assert.ok(decision.blocking_reasons.includes('RECOVERY_ENFORCEMENT_BYPASSED'));
});

test('PR-4E: strict mode passes GREEN when clean and support present', () => {
  const decision = evaluateProcessingRecoveryGate({
    mode: 'production',
    strict: true,
    recoveryMode: 'strict',
    classifierPresent: true,
    rowScopedRpcPresent: true,
    providerAmbiguousCount: 0,
    unknownProviderOutcomeCount: 0,
    requiresReviewCount: 0,
    enforcementBypassCount: 0,
  });
  assert.equal(decision.pass, true);
  assert.equal(decision.recovery_integrity, 'RECOVERY_INTEGRITY_GREEN');
});

test('PR-4E: valid waiver can pass PARTIAL when policy allows', () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const decision = evaluateProcessingRecoveryGate({
    mode: 'production',
    strict: true,
    recoveryMode: 'strict',
    classifierPresent: true,
    rowScopedRpcPresent: false,
    waiver: {
      owner: 'ops',
      reason: 'short-lived rollout',
      expiry: future,
      blastRadius: 'single provider',
    },
  });
  assert.equal(decision.pass, true);
  assert.equal(decision.recovery_integrity, 'RECOVERY_INTEGRITY_PARTIAL');
  assert.equal(decision.waiver_accepted, true);
});

test('PR-4E: incomplete waiver fails', () => {
  const decision = evaluateProcessingRecoveryGate({
    mode: 'production',
    strict: true,
    recoveryMode: 'strict',
    classifierPresent: true,
    rowScopedRpcPresent: false,
    waiver: {
      owner: 'ops',
      reason: '',
      expiry: '',
      blastRadius: '',
    },
  });
  assert.equal(decision.pass, false);
  assert.equal(decision.waiver_accepted, false);
});

test('PR-4E: expired waiver fails', () => {
  const past = new Date(Date.now() - 3600_000).toISOString();
  const decision = evaluateProcessingRecoveryGate({
    mode: 'production',
    strict: true,
    recoveryMode: 'strict',
    classifierPresent: true,
    rowScopedRpcPresent: false,
    waiver: {
      owner: 'ops',
      reason: 'temp',
      expiry: past,
      blastRadius: 'single provider',
    },
  });
  assert.equal(decision.pass, false);
  assert.equal(decision.waiver_accepted, false);
});

test('PR-4E: RED reasons are never silently waived', () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const decision = evaluateProcessingRecoveryGate({
    mode: 'production',
    strict: true,
    recoveryMode: 'strict',
    classifierPresent: true,
    rowScopedRpcPresent: true,
    providerAmbiguousCount: 2,
    waiver: {
      owner: 'ops',
      reason: 'attempted waiver',
      expiry: future,
      blastRadius: 'single provider',
    },
  });
  assert.equal(decision.pass, false);
  assert.equal(decision.recovery_integrity, 'RECOVERY_INTEGRITY_RED');
  assert.equal(decision.waiver_accepted, false);
});
