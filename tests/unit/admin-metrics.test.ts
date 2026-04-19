/**
 * Unit tests for lib/admin/metrics pure helpers.
 *
 * The DB-reading builder requires a live Supabase connection; the route-level
 * architecture test pins that wiring. These tests focus on the pure pieces:
 *   - `snapshotToSentryTags` shape + numeric stringification
 *   - `success_rate_last_24h` ratio math (edge cases)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  snapshotToSentryTags,
  type AdminMetricsSnapshot,
} from '@/lib/admin/metrics';

function baseSnapshot(
  overrides: Partial<AdminMetricsSnapshot> = {}
): AdminMetricsSnapshot {
  return {
    ok: true,
    timestamp: '2026-04-19T10:00:00.000Z',
    outbox: { pending: 0, processing: 0, failed: 0, processed_last_24h: 0 },
    queue: {
      queued: 0,
      retry: 0,
      processing: 0,
      uploaded: 0,
      completed_last_24h: 0,
      failed: 0,
      dead_letter_depth: 0,
    },
    signals: { pending: 0, processed_last_24h: 0, failed: 0 },
    dlq: { sync_dlq_depth: 0 },
    success_rate_last_24h: { queue: null, outbox: null },
    ...overrides,
  };
}

test('snapshotToSentryTags flattens every metric into a string map', () => {
  const snap = baseSnapshot({
    outbox: { pending: 7, processing: 2, failed: 1, processed_last_24h: 500 },
    queue: {
      queued: 3,
      retry: 1,
      processing: 2,
      uploaded: 4,
      completed_last_24h: 990,
      failed: 10,
      dead_letter_depth: 2,
    },
    signals: { pending: 5, processed_last_24h: 220, failed: 3 },
    dlq: { sync_dlq_depth: 9 },
    success_rate_last_24h: { queue: 0.99, outbox: 0.998 },
  });
  const tags = snapshotToSentryTags(snap);
  assert.equal(tags['route'], '/api/admin/metrics');
  assert.equal(tags['metrics.outbox.pending'], '7');
  assert.equal(tags['metrics.outbox.failed'], '1');
  assert.equal(tags['metrics.queue.queued'], '3');
  assert.equal(tags['metrics.queue.failed'], '10');
  assert.equal(tags['metrics.queue.dead_letter_depth'], '2');
  assert.equal(tags['metrics.signals.pending'], '5');
  assert.equal(tags['metrics.signals.failed'], '3');
  assert.equal(tags['metrics.dlq.sync_dlq_depth'], '9');
  assert.equal(tags['metrics.success_rate_24h.queue'], '0.99');
  assert.equal(tags['metrics.success_rate_24h.outbox'], '0.998');
  // Values must all be strings (Sentry tag contract).
  for (const [k, v] of Object.entries(tags)) {
    assert.equal(typeof v, 'string', `tag ${k} is not a string`);
    assert.ok(v.length <= 200, `tag ${k} value exceeds 200 chars`);
  }
});

test('snapshotToSentryTags omits success-rate tags when the ratio is null', () => {
  const snap = baseSnapshot({
    success_rate_last_24h: { queue: null, outbox: null },
  });
  const tags = snapshotToSentryTags(snap);
  assert.equal(tags['metrics.success_rate_24h.queue'], undefined);
  assert.equal(tags['metrics.success_rate_24h.outbox'], undefined);
});

test('snapshotToSentryTags includes only the non-null success-rate tag', () => {
  const snap = baseSnapshot({
    success_rate_last_24h: { queue: 1, outbox: null },
  });
  const tags = snapshotToSentryTags(snap);
  assert.equal(tags['metrics.success_rate_24h.queue'], '1');
  assert.equal(tags['metrics.success_rate_24h.outbox'], undefined);
});

test('snapshotToSentryTags keeps under the 50-tag Sentry soft cap', () => {
  const snap = baseSnapshot({
    success_rate_last_24h: { queue: 1, outbox: 1 },
  });
  const tags = snapshotToSentryTags(snap);
  assert.ok(
    Object.keys(tags).length <= 50,
    `Sentry tag count ${Object.keys(tags).length} exceeds the 50-tag soft cap`
  );
});
