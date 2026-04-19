/**
 * Unit tests for the OCI outbox notifier (Phase 4 f4-notify-outbox).
 *
 * We test the pure `buildOutboxNotifyPayload` builder to verify the
 * deduplicationId strategy and body shape. End-to-end QStash publishing is
 * validated in production smoke; this test pins the bucketing / key contract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOutboxNotifyPayload, NOTIFY_BUCKET_MS } from '@/lib/oci/notify-outbox';

test('buildOutboxNotifyPayload produces a stable body shape', () => {
  const now = new Date('2026-04-19T10:00:00.000Z');
  const payload = buildOutboxNotifyPayload({
    callId: 'call-1',
    siteId: 'site-1',
    source: 'seal_bearer',
    now,
  });
  assert.ok(payload.url.endsWith('/api/workers/oci/process-outbox'), 'url must target the outbox worker');
  assert.equal(payload.body.kind, 'oci_outbox_trigger');
  assert.equal(payload.body.call_id, 'call-1');
  assert.equal(payload.body.site_id, 'site-1');
  assert.equal(payload.body.source, 'seal_bearer');
  assert.equal(payload.body.emitted_at, now.toISOString());
  assert.ok(payload.deduplicationId.startsWith('oci-outbox:call-1:'), 'dedup id must be keyed on callId');
});

test('buildOutboxNotifyPayload buckets rapid retries into the same dedup id', () => {
  const t0 = new Date('2026-04-19T10:00:00.000Z');
  const t5 = new Date(t0.getTime() + 5_000); // still within the 10s bucket
  const tNext = new Date(t0.getTime() + NOTIFY_BUCKET_MS);

  const a = buildOutboxNotifyPayload({ callId: 'call-x', siteId: 's', source: 'seal', now: t0 });
  const b = buildOutboxNotifyPayload({ callId: 'call-x', siteId: 's', source: 'seal', now: t5 });
  const c = buildOutboxNotifyPayload({ callId: 'call-x', siteId: 's', source: 'seal', now: tNext });

  assert.equal(a.deduplicationId, b.deduplicationId, 'same bucket must yield same dedup id');
  assert.notEqual(
    a.deduplicationId,
    c.deduplicationId,
    'next bucket must emit a new dedup id so real retries do go through'
  );
});

test('buildOutboxNotifyPayload never coalesces different calls even at the same instant', () => {
  const now = new Date('2026-04-19T10:00:00.000Z');
  const a = buildOutboxNotifyPayload({ callId: 'call-A', siteId: 's', source: 'seal', now });
  const b = buildOutboxNotifyPayload({ callId: 'call-B', siteId: 's', source: 'seal', now });
  assert.notEqual(a.deduplicationId, b.deduplicationId);
});

test('buildOutboxNotifyPayload defaults now to a real Date when omitted', () => {
  const before = Date.now();
  const payload = buildOutboxNotifyPayload({ callId: 'call-1', siteId: 's', source: 'seal' });
  const after = Date.now();
  const emitted = Date.parse(payload.body.emitted_at);
  assert.ok(
    emitted >= before && emitted <= after,
    `emitted_at (${payload.body.emitted_at}) must fall within the test window [${before}, ${after}]`
  );
});
