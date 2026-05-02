import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCallSendableForSealExport,
  isCallSendableForOutboxSignalStage,
  isCallStatusSendableForSignal,
} from '@/lib/oci/call-sendability';

test('canonical contacted and offered signals remain sendable while call status is intent', () => {
  assert.equal(isCallStatusSendableForSignal('intent', 'contacted'), true);
  assert.equal(isCallStatusSendableForSignal('intent', 'offered'), true);
  assert.equal(isCallStatusSendableForSignal('intent', 'legacy_signal'), false);
});

test('outbox contacted/offered signals match panel call statuses contacted and offered', () => {
  assert.equal(isCallSendableForOutboxSignalStage('contacted', 'contacted'), true);
  assert.equal(isCallSendableForOutboxSignalStage('offered', 'offered'), true);
});

test('sale-like signal rows still require confirmed sendable statuses', () => {
  assert.equal(isCallStatusSendableForSignal('intent', 'won'), false);
  assert.equal(isCallStatusSendableForSignal('confirmed', 'won'), true);
});

test('panel won status is sendable for seal outbox path without war-room oci sealed', () => {
  assert.equal(isCallSendableForSealExport('won', null), true);
  assert.equal(isCallSendableForSealExport('won', 'pending'), true);
});
