/**
 * Unit tests for lib/ingest/normalize-landing-url: deterministic strip fragment and UTM.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLandingUrl } from '@/lib/ingest/normalize-landing-url';

test('normalizeLandingUrl: strips fragment', () => {
  const a = normalizeLandingUrl('https://example.com/page#section');
  const b = normalizeLandingUrl('https://example.com/page');
  assert.equal(a, b, 'same base URL with and without fragment');
  assert.ok(!a.includes('#'));
});

test('normalizeLandingUrl: strips UTM params for stable comparison', () => {
  const a = normalizeLandingUrl('https://example.com/landing?utm_source=google&utm_medium=cpc');
  const b = normalizeLandingUrl('https://example.com/landing?utm_campaign=brand');
  const base = normalizeLandingUrl('https://example.com/landing');
  assert.equal(a, base);
  assert.equal(b, base);
});

test('normalizeLandingUrl: strips gclid/wbraid/gbraid', () => {
  const withGclid = normalizeLandingUrl('https://site.com/?gclid=EAIaIQobChMI');
  const without = normalizeLandingUrl('https://site.com/');
  assert.equal(withGclid, without);
});

test('normalizeLandingUrl: same normalized URL equals (reuse case)', () => {
  const u1 = normalizeLandingUrl('https://mysite.com/page?utm_source=fb&utm_medium=social');
  const u2 = normalizeLandingUrl('https://mysite.com/page?gclid=abc1234567');
  assert.equal(u1, u2);
});

test('normalizeLandingUrl: different paths not equal', () => {
  const a = normalizeLandingUrl('https://example.com/page-a');
  const b = normalizeLandingUrl('https://example.com/page-b');
  assert.notEqual(a, b);
});
