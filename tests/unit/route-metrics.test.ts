import test from 'node:test';
import assert from 'node:assert/strict';

import { computeApproxErrorRate } from '@/lib/route-metrics';

test('computeApproxErrorRate: null when no requests', () => {
  const r = computeApproxErrorRate('sync', {});
  assert.equal(r.total, 0);
  assert.equal(r.error_rate, null);
});

test('computeApproxErrorRate: 5xx / total', () => {
  const m = {
    route_sync_requests_total: 100,
    route_sync_http_5xx: 2,
    route_sync_http_2xx: 98,
  };
  const r = computeApproxErrorRate('sync', m);
  assert.equal(r.total, 100);
  assert.equal(r.http_5xx, 2);
  assert.equal(r.error_rate, 0.02);
});
