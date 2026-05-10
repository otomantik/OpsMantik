import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhoneIdentity } from '@/lib/dic/phone-hash';
import { hashPhoneSha256E164 } from '@/lib/oci/validation/crypto';

test('buildPhoneIdentity uses OCI SSOT hash (SHA-256 hex of normalized +E.164)', () => {
  const raw = '0532 123 45 67';
  const got = buildPhoneIdentity({ rawPhone: raw, countryIso: 'TR' });
  assert.equal(got.reason, 'ok');
  assert.ok(got.e164);
  assert.match(String(got.hash), /^[a-f0-9]{64}$/);
  assert.equal(got.hash, hashPhoneSha256E164(raw, { defaultCountryIso: 'TR' }));
});

test('buildPhoneIdentity never returns hash without normalization success path for typical TR input', () => {
  const got = buildPhoneIdentity({ rawPhone: '0532 123 45 67', countryIso: 'TR' });
  assert.equal(Boolean(got.hash && got.e164), true);
});
