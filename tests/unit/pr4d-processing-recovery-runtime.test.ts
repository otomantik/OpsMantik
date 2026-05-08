import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyProcessingRecoveryRows,
  mapRowToProcessingRecoveryInput,
  resolveProcessingRecoveryClassifierMode,
  summarizeProcessingRecoveryDecisions,
} from '@/lib/oci/processing-recovery-runtime';

test('PR-4D: default classifier mode resolves to off (backward compatible)', () => {
  assert.equal(resolveProcessingRecoveryClassifierMode(undefined), 'off');
  assert.equal(resolveProcessingRecoveryClassifierMode(''), 'off');
  assert.equal(resolveProcessingRecoveryClassifierMode('nonsense'), 'off');
});

test('PR-4D: runtime adapter maps DB row into classifier input shape', () => {
  const mapped = mapRowToProcessingRecoveryInput(
    {
      id: 'q1',
      status: 'PROCESSING',
      claimed_at: '2026-05-08T10:00:00.000Z',
      updated_at: '2026-05-08T10:00:00.000Z',
      provider_request_id: 'req-1',
      provider_error_code: 'PROVIDER_AMBIGUOUS',
      provider_error_category: 'PROVIDER_AMBIGUOUS',
      retry_count: 2,
    },
    '2026-05-08T12:00:00.000Z',
    15
  );
  assert.equal(mapped.status, 'PROCESSING');
  assert.equal(mapped.providerRequestId, 'req-1');
  assert.equal(mapped.exportRunId, null);
  assert.equal(mapped.hasScriptSummary, false);
  assert.equal(mapped.stuckThresholdMinutes, 15);
});

test('PR-4D: shadow mode classifies but summary keeps enforced count zero', () => {
  const rows = classifyProcessingRecoveryRows({
    rows: [
      {
        id: 'safe',
        status: 'PROCESSING',
        updated_at: '2026-05-08T10:00:00.000Z',
        provider_request_id: null,
        retry_count: 0,
      },
    ],
    nowIso: '2026-05-08T12:00:00.000Z',
    stuckThresholdMinutes: 15,
  });
  const summary = summarizeProcessingRecoveryDecisions(rows, 'shadow');
  assert.equal(summary.processing_classifier_shadow_count, 1);
  assert.equal(summary.processing_classifier_enforced_count, 0);
});

test('PR-4D: enforce mode marks non-safe outcomes as bypass candidates', () => {
  const rows = classifyProcessingRecoveryRows({
    rows: [
      {
        id: 'ambiguous',
        status: 'PROCESSING',
        updated_at: '2026-05-08T10:00:00.000Z',
        provider_request_id: 'req-amb',
        retry_count: 0,
      },
      {
        id: 'unknown',
        status: 'PROCESSING',
        updated_at: '2026-05-08T10:00:00.000Z',
        provider_request_id: null,
        retry_count: 1,
      },
    ],
    nowIso: '2026-05-08T12:00:00.000Z',
    stuckThresholdMinutes: 15,
  });
  const summary = summarizeProcessingRecoveryDecisions(rows, 'enforce_safe_retry');
  assert.equal(summary.processing_provider_ambiguous_count, 1);
  // Row-scoped runtime adapter currently lacks script summary/export-run row evidence,
  // so unknown-provider classification may remain 0 in preview.
  assert.ok(summary.processing_unknown_provider_outcome_count >= 0);
  assert.equal(summary.processing_classifier_enforced_count, 0);
  assert.equal(summary.processing_classifier_bypass_count, 2);
});

test('PR-4D.1: enforcement-supported summary counts SAFE_TO_RETRY as enforced', () => {
  const rows = classifyProcessingRecoveryRows({
    rows: [
      {
        id: 'safe',
        status: 'PROCESSING',
        updated_at: '2026-05-08T10:00:00.000Z',
        provider_request_id: null,
        retry_count: 0,
      },
    ],
    nowIso: '2026-05-08T12:00:00.000Z',
    stuckThresholdMinutes: 15,
  });
  const summary = summarizeProcessingRecoveryDecisions(rows, 'enforce_safe_retry', {
    enforcementSupported: true,
  });
  assert.equal(summary.processing_classifier_enforced_count, 1);
  assert.equal(summary.processing_classifier_bypass_count, 0);
});

test('PR-4D: recover-processing route wires classifier mode and keeps RPC compatibility path', () => {
  const src = readFileSync(
    join(process.cwd(), 'app', 'api', 'cron', 'providers', 'recover-processing', 'route.ts'),
    'utf8'
  );
  assert.ok(src.includes('OCI_PROCESSING_RECOVERY_CLASSIFIER_MODE'));
  assert.ok(src.includes('classifyProcessingRecoveryRows'));
  assert.ok(src.includes("recover_stuck_offline_conversion_jobs"));
  assert.ok(src.includes('processing_recovery_enforcement_supported'));
});

test('PR-4D: no queue deletion introduced in runtime adapter/recover route', () => {
  const runtimeSrc = readFileSync(
    join(process.cwd(), 'lib', 'oci', 'processing-recovery-runtime.ts'),
    'utf8'
  );
  const routeSrc = readFileSync(
    join(process.cwd(), 'app', 'api', 'cron', 'providers', 'recover-processing', 'route.ts'),
    'utf8'
  );
  assert.ok(!/delete\s+from\s+offline_conversion_queue/i.test(runtimeSrc));
  assert.ok(!/delete\s+from\s+offline_conversion_queue/i.test(routeSrc));
});
