import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { appendIdentityGraphEdge, fingerprintDigestSha256 } from '@/lib/domain/truth/identity-graph-writer';
import { getRefactorMetricsMemory, resetRefactorMetricsMemoryForTests } from '@/lib/refactor/metrics';

test('fingerprintDigestSha256: stable for same input', () => {
  const a = fingerprintDigestSha256('fp-test');
  const b = fingerprintDigestSha256('fp-test');
  assert.equal(a.length, 64);
  assert.equal(a, b);
});

test('appendIdentityGraphEdge: flag off does not increment probe metric', async () => {
  const prev = process.env.IDENTITY_GRAPH_ENABLED;
  try {
    delete process.env.IDENTITY_GRAPH_ENABLED;
    resetRefactorMetricsMemoryForTests();
    await appendIdentityGraphEdge({
      siteId: '00000000-0000-0000-0000-000000000001',
      edgeKind: 'FINGERPRINT_SESSION_BRIDGE',
      ingestSource: 'CALL_EVENT_V2',
      fingerprint: 'x',
      sessionId: '00000000-0000-0000-0000-000000000002',
      idempotencyKey: 'ig-unit-1',
    });
    assert.equal(getRefactorMetricsMemory().identity_graph_probe_total, 0);
  } finally {
    if (prev === undefined) delete process.env.IDENTITY_GRAPH_ENABLED;
    else process.env.IDENTITY_GRAPH_ENABLED = prev;
  }
});
