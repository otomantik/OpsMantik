/**
 * DIC E.164 deep-validation: complex formats, no double country code.
 * - 0 (532) 123-4567, +90 532 123 45 67 → single 90 prefix, digits only.
 * - 0090 532... must not become 9090532...
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToE164 } from '@/lib/dic/e164';

test('TR: 0 (532) 123-4567 → 905321234567', () => {
  const out = normalizeToE164('0 (532) 123-4567', 'TR');
  assert.equal(out, '905321234567');
});

test('TR: +90 532 123 45 67 → 905321234567 (no double 90)', () => {
  const out = normalizeToE164('+90 532 123 45 67', 'TR');
  assert.equal(out, '905321234567');
});

test('TR: 0090 532 123 45 67 → 905321234567 (strip 00, do not duplicate 90)', () => {
  const out = normalizeToE164('0090 532 123 45 67', 'TR');
  assert.equal(out, '905321234567');
});

test('TR: 0532 123 45 67 (spaces only) → 905321234567', () => {
  const out = normalizeToE164('0532 123 45 67', 'TR');
  assert.equal(out, '905321234567');
});

test('TR: all non-numeric stripped; leading 0 triggers country prefix', () => {
  const out = normalizeToE164('0 (532) 123-4567', 'TR');
  assert.equal(out, '905321234567');
  assert.ok(!out!.includes(' '), 'output must be digits only');
  assert.ok(out!.startsWith('90') && !out!.startsWith('9090'), 'single country code');
});

test('US: +1 555 123 4567 → 15551234567', () => {
  const out = normalizeToE164('+1 555 123 4567', 'US');
  assert.equal(out, '15551234567');
});

test('US: 1-555-123-4567 (already has 1) → 15551234567', () => {
  const out = normalizeToE164('1-555-123-4567', 'US');
  assert.equal(out, '15551234567');
});

test('GB: +44 20 7946 0958 → 442079460958', () => {
  const out = normalizeToE164('+44 20 7946 0958', 'GB');
  assert.equal(out, '442079460958');
});

test('invalid: too few digits returns null', () => {
  assert.equal(normalizeToE164('123', 'TR'), null);
  assert.equal(normalizeToE164('0532', 'TR'), null);
});

test('invalid: empty or non-string returns null', () => {
  assert.equal(normalizeToE164('', 'TR'), null);
  assert.equal(normalizeToE164('  ', 'TR'), null);
  assert.equal(normalizeToE164(null as unknown as string, 'TR'), null);
  assert.equal(normalizeToE164('5321234567', null as unknown as string), null);
});

test('TR: digits only no leading 0 gets country prefix', () => {
  const out = normalizeToE164('5321234567', 'TR');
  assert.equal(out, '905321234567');
});

test('TR: 90 already present in digits (no +) → single 90', () => {
  const out = normalizeToE164('90 532 123 45 67', 'TR');
  assert.equal(out, '905321234567');
});
