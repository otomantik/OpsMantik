import test from 'node:test';
import assert from 'node:assert/strict';
import { hashNormalizedEmail, hashNormalizedPhoneE164, normalizePhoneToE164 } from '@/lib/oci/validation/crypto';

test('normalizePhoneToE164 collapses common TR local formats', () => {
  const a = normalizePhoneToE164('0532 123 45 67');
  const b = normalizePhoneToE164('+90 532 123 45 67');
  const c = normalizePhoneToE164('00905321234567');
  assert.equal(a, '+905321234567');
  assert.equal(a, b);
  assert.equal(a, c);
});

test('hashNormalizedPhoneE164 is deterministic across equivalent inputs', () => {
  const a = hashNormalizedPhoneE164('0532 123 45 67');
  const b = hashNormalizedPhoneE164('+905321234567');
  assert.ok(a?.sha256);
  assert.equal(a?.sha256, b?.sha256);
});

test('hashNormalizedEmail lowercases and trims before hash', () => {
  const a = hashNormalizedEmail('  Test@Example.COM ');
  const b = hashNormalizedEmail('test@example.com');
  assert.equal(a, b);
});
