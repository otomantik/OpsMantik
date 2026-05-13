import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ociAckStrictObjectBodySchema,
  parseAckJsonEnvelope,
} from '@/lib/oci/oci-ack-route-helpers';

test('parseAckJsonEnvelope: Koç-shaped script payload passes strict allow-list', () => {
  const raw = {
    siteId: 'Eslamed',
    queueIds: ['seal_00000000-0000-4000-8000-000000000001'],
    exportRunId: 'run-1',
    export_run_id: 'run-1',
    pendingConfirmation: true,
    providerConfirmationMode: 'bulk_upload_async_unconfirmed' as const,
    skippedIds: ['seal_00000000-0000-4000-8000-000000000002'],
  };
  const r = parseAckJsonEnvelope(raw);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.body.queueIds, raw.queueIds);
  assert.equal(r.body.pendingConfirmation, true);
});

test('parseAckJsonEnvelope: unknown top-level key is ACK_SCHEMA_VIOLATION path (strict)', () => {
  const r = parseAckJsonEnvelope({
    siteId: 'x',
    queueIds: ['seal_a'],
    evilKey: true,
  });
  assert.equal(r.ok, false);
  if (r.ok || r.reason !== 'schema_violation') return;
  assert.ok(r.issues.some((i) => i.message.toLowerCase().includes('unrecognized') || i.path.includes('evil')));
});

test('parseAckJsonEnvelope: array body over 5000 items fails schema', () => {
  const row = { id: 'seal_x', status: 'SUCCESS' as const };
  const arr = Array.from({ length: 5001 }, () => ({ ...row }));
  const r = parseAckJsonEnvelope(arr);
  assert.equal(r.ok, false);
});

test('ociAckStrictObjectBodySchema: Production + Universal keys only', () => {
  const parsed = ociAckStrictObjectBodySchema.parse({
    siteId: 'uuid-or-slug',
    queueIds: ['a'],
    pendingConfirmation: true,
    providerConfirmationMode: 'bulk_upload_async_unconfirmed',
    export_run_id: 'r1',
    exportRunId: 'r1',
  });
  assert.equal(parsed.pendingConfirmation, true);
});
