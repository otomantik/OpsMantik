import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  normalizeEmailForGoogleAds,
  normalizePhoneForGoogleAds,
  buildGoogleAdsUserIdentifiers,
  GOOGLE_ADS_USER_ID_NORMALIZATION_VERSION,
} from '@/lib/oci/google-ads-user-identifier-normalization';

test('normalizeEmailForGoogleAds: lowercase and strip spaces', () => {
  assert.equal(normalizeEmailForGoogleAds('  Test.User@EXAMPLE.com  '), 'test.user@example.com');
});

test('normalizePhoneForGoogleAds: adds country code', () => {
  const n = normalizePhoneForGoogleAds('5551234567', '90');
  assert.match(n, /^\+905551234567$/);
});

test('buildGoogleAdsUserIdentifiers: consent gate', () => {
  const r = buildGoogleAdsUserIdentifiers({
    email: 'fake@example.com',
    consentUserIdentifiers: false,
  });
  assert.equal(r.userIdentifiers, null);
  assert.equal(r.skippedReason, 'CONSENT_MISSING');
});

test('buildGoogleAdsUserIdentifiers: produces sha256 hex', () => {
  const email = 'sample@example.com';
  const r = buildGoogleAdsUserIdentifiers({
    email,
    consentUserIdentifiers: true,
  });
  assert.ok(r.userIdentifiers?.hashed_email);
  assert.equal(r.userIdentifiers?.normalization_version, GOOGLE_ADS_USER_ID_NORMALIZATION_VERSION);
  const expected = createHash('sha256').update(normalizeEmailForGoogleAds(email), 'utf8').digest('hex');
  assert.equal(r.userIdentifiers?.hashed_email, expected);
});
