import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScriptAckPendingConfirmation } from '@/lib/oci/oci-ack-route-helpers';
import { buildAckPayloadHash } from '@/lib/oci/ack-receipt';

test('PR-9K: bulk_upload_async_unconfirmed implies pending confirmation semantics', () => {
  assert.equal(resolveScriptAckPendingConfirmation({}), false);
  assert.equal(resolveScriptAckPendingConfirmation({ pendingConfirmation: false }), false);
  assert.equal(resolveScriptAckPendingConfirmation({ pendingConfirmation: true }), true);
  assert.equal(
    resolveScriptAckPendingConfirmation({ providerConfirmationMode: 'bulk_upload_async_unconfirmed' }),
    true
  );
});

test('PR-9K: ack payload hash distinguishes providerConfirmationMode', () => {
  const base = {
    siteId: '3276893e-0433-4e35-95f2-4e80cf863f4c',
    kind: 'ACK' as const,
    queueIds: ['seal_a', 'seal_b'],
  };
  const h1 = buildAckPayloadHash({ ...base, pendingConfirmation: false, providerConfirmationMode: null });
  const h2 = buildAckPayloadHash({
    ...base,
    pendingConfirmation: false,
    providerConfirmationMode: 'bulk_upload_async_unconfirmed',
  });
  assert.notEqual(h1, h2);
});
