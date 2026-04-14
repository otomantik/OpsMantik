import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { probeFunnelProjectionDualRead } from '@/lib/domain/truth/projection-dual-read';
import { getRefactorMetricsMemory, resetRefactorMetricsMemoryForTests } from '@/lib/refactor/metrics';

test('probeFunnelProjectionDualRead: flag off does not increment probe metric', async () => {
  const prev = process.env.TRUTH_PROJECTION_READ_ENABLED;
  try {
    delete process.env.TRUTH_PROJECTION_READ_ENABLED;
    resetRefactorMetricsMemoryForTests();
    await probeFunnelProjectionDualRead('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'sync');
    assert.equal(getRefactorMetricsMemory().truth_projection_read_probe_total, 0);
    assert.equal(getRefactorMetricsMemory().truth_projection_drift_total, 0);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_PROJECTION_READ_ENABLED;
    else process.env.TRUTH_PROJECTION_READ_ENABLED = prev;
  }
});
