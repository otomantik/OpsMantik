import test from 'node:test';
import assert from 'node:assert/strict';
import { isCallStatusSendableForSignal } from '@/lib/oci/call-sendability';

test('canonical contacted and offered signals remain sendable while call status is intent', () => {
  assert.equal(isCallStatusSendableForSignal('intent', 'contacted'), true);
  assert.equal(isCallStatusSendableForSignal('intent', 'offered'), true);
  assert.equal(isCallStatusSendableForSignal('intent', 'legacy_signal'), false);
});

test('sale-like signal rows still require confirmed sendable statuses', () => {
  assert.equal(isCallStatusSendableForSignal('intent', 'won'), false);
  assert.equal(isCallStatusSendableForSignal('confirmed', 'won'), true);
});
