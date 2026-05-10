import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  hashPhoneSha256E164,
  hashPhoneSha256E164Only,
  isSha256Hex,
  normalizePhoneToE164,
  PhoneNormalizeError,
  sha256Hex,
} from '@/lib/oci/validation/crypto';

test('normalizePhoneToE164: TR local formats', () => {
  const expected = '+905321234567';
  assert.equal(normalizePhoneToE164('0532 123 45 67'), expected);
  assert.equal(normalizePhoneToE164('+90 532 123 4567'), expected);
  assert.equal(normalizePhoneToE164('5321234567'), expected);
  assert.equal(normalizePhoneToE164('0090 532 123 4567'), expected);
});

test('sha256Hex / hashPhoneSha256E164: lowercase 64-char hex over +E.164 UTF-8', () => {
  const raw = '0532 123 45 67';
  const norm = normalizePhoneToE164(raw);
  const h = hashPhoneSha256E164(raw);
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.equal(h, createHash('sha256').update(norm, 'utf8').digest('hex'));
  assert.equal(h, sha256Hex(norm));
  assert.equal(isSha256Hex(h), true);
});

test('hashPhoneSha256E164Only hashes canonical +E.164 string', () => {
  const norm = '+905321234567';
  assert.equal(hashPhoneSha256E164Only(norm), sha256Hex(norm));
});

test('empty / invalid phone throws deterministic PhoneNormalizeError', () => {
  assert.throws(() => normalizePhoneToE164(''), (e: unknown) => e instanceof PhoneNormalizeError);
  assert.throws(() => normalizePhoneToE164('   '), (e: unknown) => e instanceof PhoneNormalizeError);
  assert.throws(() => hashPhoneSha256E164(''), (e: unknown) => e instanceof PhoneNormalizeError);
});

test('hashPhoneSha256E164Only rejects non-E.164', () => {
  assert.throws(() => hashPhoneSha256E164Only('90532'), (e: unknown) => e instanceof PhoneNormalizeError);
});
