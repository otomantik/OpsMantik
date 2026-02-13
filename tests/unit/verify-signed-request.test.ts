import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { verifySignedRequest } from '@/lib/security/verify-signed-request';

test('timingSafeCompare: equal strings', () => {
  assert.equal(timingSafeCompare('abc', 'abc'), true);
});

test('timingSafeCompare: different strings (same length)', () => {
  assert.equal(timingSafeCompare('abc', 'abd'), false);
});

test('timingSafeCompare: different lengths', () => {
  assert.equal(timingSafeCompare('short', 'a much longer string'), false);
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
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.siteId, 'site_public_id');
    assert.equal(res.ts, ts);
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
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error, 'Signature expired');
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
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error, 'Invalid signature');
});

