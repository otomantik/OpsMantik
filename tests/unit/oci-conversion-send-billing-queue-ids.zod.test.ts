import test from 'node:test';
import assert from 'node:assert/strict';
import { ociConversionSendBillingQueueIdsSchema } from '@/lib/billing/oci-conversion-send-billing-queue-ids.zod';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';

test('accepts dedupe-safe unique uuid list', () => {
  const out = ociConversionSendBillingQueueIdsSchema.parse([a, b]);
  assert.deepEqual(out, [a, b]);
});

test('rejects empty array', () => {
  const r = ociConversionSendBillingQueueIdsSchema.safeParse([]);
  assert.equal(r.success, false);
});

test('rejects duplicate ids', () => {
  const r = ociConversionSendBillingQueueIdsSchema.safeParse([a, a]);
  assert.equal(r.success, false);
});

test('rejects invalid uuid string', () => {
  const r = ociConversionSendBillingQueueIdsSchema.safeParse(['not-a-uuid']);
  assert.equal(r.success, false);
});
