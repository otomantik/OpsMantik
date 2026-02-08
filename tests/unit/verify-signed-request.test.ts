import { test, expect } from 'vitest';
import { createHmac } from 'node:crypto';

import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { verifySignedRequest } from '@/lib/security/verify-signed-request';

test('timingSafeCompare: equal strings', () => {
  expect(timingSafeCompare('abc', 'abc')).toBe(true);
});

test('timingSafeCompare: different strings (same length)', () => {
  expect(timingSafeCompare('abc', 'abd')).toBe(false);
});

test('timingSafeCompare: different lengths', () => {
  expect(timingSafeCompare('short', 'a much longer string')).toBe(false);
});

test('verifySignedRequest: accepts correct signature', () => {
  const secret = 'test-secret';
  const rawBody = JSON.stringify({ site_id: 'site_public_id', fingerprint: 'fp', phone_number: 'tel:123' });
  const ts = 1700000000;
  const sig = createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');

  const headers = new Headers({
    'x-ops-site-id': 'site_public_id',
    'x-ops-ts': String(ts),
    'x-ops-signature': sig,
  });

  const res = verifySignedRequest({ rawBody, headers, secrets: [secret], nowSec: ts + 10 });
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.siteId).toBe('site_public_id');
    expect(res.ts).toBe(ts);
  }
});

test('verifySignedRequest: rejects replay (expired ts)', () => {
  const secret = 'test-secret';
  const rawBody = JSON.stringify({ site_id: 'site_public_id', fingerprint: 'fp' });
  const ts = 1700000000;
  const sig = createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');
  const headers = new Headers({
    'x-ops-site-id': 'site_public_id',
    'x-ops-ts': String(ts),
    'x-ops-signature': sig,
  });

  const res = verifySignedRequest({ rawBody, headers, secrets: [secret], nowSec: ts + 301 });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toBe('Signature expired');
});

test('verifySignedRequest: rejects invalid signature', () => {
  const secret = 'test-secret';
  const rawBody = JSON.stringify({ site_id: 'site_public_id', fingerprint: 'fp' });
  const headers = new Headers({
    'x-ops-site-id': 'site_public_id',
    'x-ops-ts': '1700000000',
    'x-ops-signature': '0'.repeat(64),
  });

  const res = verifySignedRequest({ rawBody, headers, secrets: [secret], nowSec: 1700000001 });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toBe('Invalid signature');
});

