/**
 * PR-OCI-7: Attribution sanitization (sentinel, template, DSA surrogate)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeParam, sanitizeClickId, extractUTM } from '@/lib/attribution';

test('sanitizeParam: " null " → undefined', () => {
  assert.equal(sanitizeParam(' null '), undefined);
});

test('sanitizeParam: "{keyword}" → undefined (template)', () => {
  assert.equal(sanitizeParam('{keyword}'), undefined);
});

test('sanitizeParam: "%7Bkeyword%7D" (decode once) → template → undefined', () => {
  assert.equal(sanitizeParam('%7Bkeyword%7D'), undefined);
});

test('sanitizeParam: "(not set)" → undefined', () => {
  assert.equal(sanitizeParam('(not set)'), undefined);
});

test('sanitizeParam: valid value preserved', () => {
  const val = 'GCLID123abcXYZ_valid_term';
  assert.equal(sanitizeParam(val), val);
});

test('sanitizeParam: null/undefined → undefined', () => {
  assert.equal(sanitizeParam(null), undefined);
  assert.equal(sanitizeParam(undefined), undefined);
});

test('sanitizeParam: "(none)" → undefined', () => {
  assert.equal(sanitizeParam('(none)'), undefined);
});

test('sanitizeParam: "n/a" → undefined', () => {
  assert.equal(sanitizeParam('n/a'), undefined);
});

test('sanitizeParam: empty string → undefined', () => {
  assert.equal(sanitizeParam(''), undefined);
  assert.equal(sanitizeParam('   '), undefined);
});

test('sanitizeClickId: length < 10 → undefined', () => {
  assert.equal(sanitizeClickId('short'), undefined);
  assert.equal(sanitizeClickId('123456789'), undefined);
});

test('sanitizeClickId: contains { or } → undefined', () => {
  assert.equal(sanitizeClickId('abc{keyword}def1234567890'), undefined);
  assert.equal(sanitizeClickId('valid_gclid_12345}'), undefined);
});

test('sanitizeClickId: valid gclid preserved', () => {
  const val = 'EAIaIQobChMI12345678901234567890Ab';
  assert.equal(sanitizeClickId(val), val);
});

test('extractUTM: sentinel utm_term → undefined (sanitized)', () => {
  const url = 'https://example.com/?utm_term=null&utm_source=google&utm_medium=cpc';
  const utm = extractUTM(url);
  assert.ok(utm);
  assert.equal(utm!.term, undefined);
  assert.equal(utm!.source, 'google');
});

test('extractUTM: DSA surrogate when utm_term empty - uses content', () => {
  const url = 'https://example.com/?utm_content=creative1&utm_source=google&utm_medium=cpc';
  const utm = extractUTM(url);
  assert.ok(utm);
  assert.equal(utm!.term, 'dsa:creative1');
  assert.equal(utm!.content, 'creative1');
});

test('extractUTM: DSA surrogate when term empty - uses placement over path', () => {
  const url = 'https://example.com/page?utm_source=google&utm_medium=cpc&placement=display_xyz';
  const utm = extractUTM(url);
  assert.ok(utm);
  assert.equal(utm!.term, 'dsa:display_xyz');
});

test('extractUTM: DSA surrogate when term and content empty - uses pathname', () => {
  const url = 'https://example.com/products/category?utm_source=google&utm_medium=cpc';
  const utm = extractUTM(url);
  assert.ok(utm);
  assert.ok(utm!.term?.startsWith('dsa:'));
  assert.ok(utm!.term!.includes('products'));
});
