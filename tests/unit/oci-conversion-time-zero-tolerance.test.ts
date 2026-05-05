import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSealOccurredAt, resolveSignalOccurredAtFromIntent } from '@/lib/oci/occurred-at';

test('seal occurred_at uses intent created_at when present', () => {
  const meta = resolveSealOccurredAt({
    intentCreatedAt: '2026-05-01T10:00:00.000Z',
    saleOccurredAt: '2026-05-02T10:00:00.000Z',
    fallbackConfirmedAt: '2026-05-03T10:00:00.000Z',
  });
  assert.equal(meta.occurredAt, '2026-05-01T10:00:00.000Z');
  assert.equal(meta.occurredAtSource, 'intent');
});

test('signal occurred_at uses intent created_at when present', () => {
  const meta = resolveSignalOccurredAtFromIntent({
    intentCreatedAt: '2026-05-01T10:00:00.000Z',
    fallbackSignalDate: new Date('2026-05-03T10:00:00.000Z'),
    stage: 'won',
  });
  assert.equal(meta.occurredAt, '2026-05-01T10:00:00.000Z');
  assert.equal(meta.occurredAtSource, 'intent');
});

