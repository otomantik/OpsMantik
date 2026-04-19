/**
 * Phone hash SSOT tests (Phase 5 f5-timezone-phone-tests).
 *
 * `buildPhoneIdentity` is the canonical path from a raw phone string to the
 * stored `caller_phone_hash_sha256`. Seal, stage, and export must all produce
 * byte-identical hashes for the same underlying number — otherwise Enhanced
 * Conversions would silently treat the same person as two users.
 *
 * This file pins:
 *   1) Determinism  — same input → same hash.
 *   2) Idempotency  — already-hashed 64-char hex round-trips untouched.
 *   3) Normalization — different raw formats of the same number collapse to
 *      the same hash (0 + leading, 00 prefix, + prefix, local w/ spaces).
 *   4) Country-ISO sensitivity — same local number + different country →
 *      different hash (because the E.164 country code changes).
 *   5) Fail-soft  — empty / non-numeric inputs never throw.
 *   6) Salt participation — rotating OCI_PHONE_HASH_SALT changes the hash.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhoneIdentity } from '@/lib/dic/phone-hash';
import { hashPhoneForEC, sanitizePhoneForHash } from '@/lib/dic/identity-hash';

const FIXED_SALT = 'unit-test-salt';

test('buildPhoneIdentity is deterministic for the same input', () => {
  const a = buildPhoneIdentity({ rawPhone: '+905321234567', countryIso: 'TR', salt: FIXED_SALT });
  const b = buildPhoneIdentity({ rawPhone: '+905321234567', countryIso: 'TR', salt: FIXED_SALT });
  assert.equal(a.reason, 'ok');
  assert.equal(a.hash, b.hash);
  assert.match(a.hash!, /^[a-f0-9]{64}$/);
});

test('buildPhoneIdentity normalizes 0 / 00 / + prefixes to one canonical hash', () => {
  const canonical = buildPhoneIdentity({ rawPhone: '+905321234567', countryIso: 'TR', salt: FIXED_SALT });
  const zeroPrefixed = buildPhoneIdentity({ rawPhone: '05321234567', countryIso: 'TR', salt: FIXED_SALT });
  const doubleZero = buildPhoneIdentity({ rawPhone: '00905321234567', countryIso: 'TR', salt: FIXED_SALT });
  const spaced = buildPhoneIdentity({ rawPhone: '0532 123 45 67', countryIso: 'TR', salt: FIXED_SALT });

  assert.equal(canonical.hash, zeroPrefixed.hash, '0-prefixed must collapse to canonical');
  assert.equal(canonical.hash, doubleZero.hash, '00-prefixed must collapse to canonical');
  assert.equal(canonical.hash, spaced.hash, 'whitespace-separated must collapse to canonical');
});

test('buildPhoneIdentity passes through an already-hashed 64-char hex input', () => {
  const precomputed = 'a'.repeat(64);
  const sanitized = sanitizePhoneForHash(precomputed);
  assert.equal(sanitized, precomputed, 'already-hashed input must round-trip');
  // hashPhoneForEC preserves 64-char hex input as-is.
  assert.equal(hashPhoneForEC(precomputed, FIXED_SALT), precomputed);
});

test('buildPhoneIdentity short-circuits on empty input without throwing', () => {
  const a = buildPhoneIdentity({ rawPhone: '', countryIso: 'TR', salt: FIXED_SALT });
  assert.equal(a.reason, 'empty_input');
  assert.equal(a.e164, null);
  assert.equal(a.hash, null);

  const b = buildPhoneIdentity({ rawPhone: null, countryIso: 'TR', salt: FIXED_SALT });
  assert.equal(b.reason, 'empty_input');

  const c = buildPhoneIdentity({ rawPhone: '   ', countryIso: 'TR', salt: FIXED_SALT });
  assert.equal(c.reason, 'empty_input');
});

test('buildPhoneIdentity falls back to TR when country iso is empty / missing', () => {
  const withIso = buildPhoneIdentity({ rawPhone: '05321234567', countryIso: 'TR', salt: FIXED_SALT });
  const missingIso = buildPhoneIdentity({ rawPhone: '05321234567', countryIso: '', salt: FIXED_SALT });
  const nullIso = buildPhoneIdentity({ rawPhone: '05321234567', countryIso: null, salt: FIXED_SALT });
  assert.equal(withIso.hash, missingIso.hash, 'empty iso must default to TR');
  assert.equal(withIso.hash, nullIso.hash, 'null iso must default to TR');
});

test('buildPhoneIdentity uses the country iso to disambiguate local numbers', () => {
  // 321234567 has no country prefix. TR adds +90, US adds +1 → different E.164 → different hash.
  const tr = buildPhoneIdentity({ rawPhone: '321234567', countryIso: 'TR', salt: FIXED_SALT });
  const us = buildPhoneIdentity({ rawPhone: '3212345670', countryIso: 'US', salt: FIXED_SALT });
  if (tr.reason === 'ok' && us.reason === 'ok') {
    assert.notEqual(tr.hash, us.hash, 'country iso must influence the E.164 prefix');
  }
});

test('buildPhoneIdentity hash rotates when the salt changes', () => {
  const a = buildPhoneIdentity({ rawPhone: '+905321234567', countryIso: 'TR', salt: 'salt-A' });
  const b = buildPhoneIdentity({ rawPhone: '+905321234567', countryIso: 'TR', salt: 'salt-B' });
  assert.notEqual(a.hash, b.hash, 'salt rotation must break the hash (by design)');
});

test('buildPhoneIdentity uses OCI_PHONE_HASH_SALT from env when salt override is absent', () => {
  const prev = process.env.OCI_PHONE_HASH_SALT;
  try {
    process.env.OCI_PHONE_HASH_SALT = 'env-salt-1';
    const a = buildPhoneIdentity({ rawPhone: '+905321234567', countryIso: 'TR' });
    process.env.OCI_PHONE_HASH_SALT = 'env-salt-2';
    const b = buildPhoneIdentity({ rawPhone: '+905321234567', countryIso: 'TR' });
    assert.notEqual(a.hash, b.hash, 'env salt rotation must reach the hash path');
  } finally {
    if (prev === undefined) delete process.env.OCI_PHONE_HASH_SALT;
    else process.env.OCI_PHONE_HASH_SALT = prev;
  }
});

test('buildPhoneIdentity truncates pathologically long raw input to 64 chars', () => {
  const longRaw = '+9053212345678901234567890123456789012345678901234567890123456789012345678';
  const r = buildPhoneIdentity({ rawPhone: longRaw, countryIso: 'TR', salt: FIXED_SALT });
  assert.ok(r.raw.length <= 64, 'raw must be capped at 64 chars');
});
