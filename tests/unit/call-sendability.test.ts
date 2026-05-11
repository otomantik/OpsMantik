import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCallSendableForSealExport,
  isCallSendableForOutboxSignalStage,
  isCallStatusSendableForSignal,
  isQueueRowSendableForGoogleAdsExport,
} from '@/lib/oci/call-sendability';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';

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

test('Google Ads export: contacted/offered rows sendable without sealed oci when call is intent', () => {
  assert.equal(
    isQueueRowSendableForGoogleAdsExport(OPSMANTIK_CONVERSION_NAMES.contacted, 'intent', null),
    true
  );
  assert.equal(
    isQueueRowSendableForGoogleAdsExport(OPSMANTIK_CONVERSION_NAMES.offered, 'contacted', null),
    true
  );
  assert.equal(
    isQueueRowSendableForGoogleAdsExport(OPSMANTIK_CONVERSION_NAMES.junk, 'junk', null),
    true
  );
});

test('Google Ads export: won queue row still allows panel won without sealed oci', () => {
  assert.equal(isQueueRowSendableForGoogleAdsExport(OPSMANTIK_CONVERSION_NAMES.won, 'won', null), true);
});

test('Google Ads export: contacted queue row not sendable when call is junk', () => {
  assert.equal(
    isQueueRowSendableForGoogleAdsExport(OPSMANTIK_CONVERSION_NAMES.contacted, 'junk', null),
    false
  );
});
