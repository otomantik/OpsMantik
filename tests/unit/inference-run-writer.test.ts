import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { recordInferenceRun } from '@/lib/domain/truth/inference-run-writer';
import { getRefactorMetricsMemory, resetRefactorMetricsMemoryForTests } from '@/lib/refactor/metrics';

test('recordInferenceRun: disabled flag does not increment registry metric', async () => {
  const prev = process.env.TRUTH_INFERENCE_REGISTRY_ENABLED;
  try {
    delete process.env.TRUTH_INFERENCE_REGISTRY_ENABLED;
    resetRefactorMetricsMemoryForTests();
    await recordInferenceRun({
      siteId: '00000000-0000-0000-0000-000000000001',
      inferenceKind: 'SYNC_ATTRIBUTION_V1',
      policyVersion: 'attribution:v1',
      inputDigest: 'abc',
      outputSummary: {},
      idempotencyKey: 'unit-inf-1',
      occurredAt: new Date(),
    });
    assert.equal(getRefactorMetricsMemory().truth_inference_registry_probe_total, 0);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_INFERENCE_REGISTRY_ENABLED;
    else process.env.TRUTH_INFERENCE_REGISTRY_ENABLED = prev;
  }
});
