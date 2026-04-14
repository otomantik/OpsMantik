import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { appendTruthEvidenceLedger } from '@/lib/domain/truth/truth-evidence-ledger-writer';
import { getRefactorMetricsMemory, resetRefactorMetricsMemoryForTests } from '@/lib/refactor/metrics';

test('appendTruthEvidenceLedger: disabled flag does not increment shadow metric', async () => {
  const prev = process.env.TRUTH_SHADOW_WRITE_ENABLED;
  try {
    delete process.env.TRUTH_SHADOW_WRITE_ENABLED;
    resetRefactorMetricsMemoryForTests();
    const r = await appendTruthEvidenceLedger({
      siteId: '00000000-0000-0000-0000-000000000001',
      evidenceKind: 'SYNC_EVENT_PROCESSED',
      ingestSource: 'SYNC',
      idempotencyKey: 'unit-test-key',
      occurredAt: new Date(),
      payload: { schema: 'test' },
    });
    assert.equal(r.appended, false);
    assert.equal(getRefactorMetricsMemory().truth_shadow_write_attempt_total, 0);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_SHADOW_WRITE_ENABLED;
    else process.env.TRUTH_SHADOW_WRITE_ENABLED = prev;
  }
});
