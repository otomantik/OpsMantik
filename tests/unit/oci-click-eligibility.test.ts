import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLikelyInternalTestClickId,
  sessionRowHasGoogleAdsClickId,
  trimClickId,
} from '@/lib/oci/oci-click-eligibility';

test('trimClickId: empty to null', () => {
  assert.equal(trimClickId(null), null);
  assert.equal(trimClickId(''), null);
  assert.equal(trimClickId('  '), null);
  assert.equal(trimClickId(' abc '), 'abc');
});

test('sessionRowHasGoogleAdsClickId matches is_ads_session_click_id_only semantics', () => {
  assert.equal(sessionRowHasGoogleAdsClickId({ gclid: 'x', wbraid: null, gbraid: null }), true);
  assert.equal(sessionRowHasGoogleAdsClickId({ gclid: '', wbraid: '  z ', gbraid: null }), true);
  assert.equal(sessionRowHasGoogleAdsClickId({ gclid: null, wbraid: null, gbraid: undefined }), false);
});

test('isLikelyInternalTestClickId flags smoke fixtures only', () => {
  assert.equal(isLikelyInternalTestClickId({ gclid: 'prefix_TEST_GCLID_QWERT123', wbraid: null, gbraid: null }), true);
  assert.equal(isLikelyInternalTestClickId({ gclid: 'CjwK...real', wbraid: null, gbraid: null }), false);
});
