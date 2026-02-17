/**
 * PR11: Semaphore unit tests. Redis-dependent tests may return null when Redis is unavailable (fail-open).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireSemaphore,
  releaseSemaphore,
  siteProviderKey,
  globalProviderKey,
} from '@/lib/providers/limits/semaphore';

test('siteProviderKey returns conc:siteId:providerKey', () => {
  assert.equal(siteProviderKey('site-uuid', 'google_ads'), 'conc:site-uuid:google_ads');
});

test('globalProviderKey returns conc:global:providerKey', () => {
  assert.equal(globalProviderKey('google_ads'), 'conc:global:google_ads');
});

test('acquireSemaphore with limit 0 returns null', async () => {
  const token = await acquireSemaphore('test:limit0', 0, 60000);
  assert.equal(token, null);
});

test('acquireSemaphore with limit 1 returns token or null (Redis may be unavailable)', async () => {
  const key = `test:pr11:${Date.now()}`;
  const token = await acquireSemaphore(key, 1, 120000);
  if (token !== null) {
    assert.ok(typeof token === 'string' && token.length > 0);
    await releaseSemaphore(key, token);
  }
});

test('acquireSemaphore when at limit returns null (second acquire with limit 1)', async () => {
  const key = `test:pr11:limit1:${Date.now()}`;
  const t1 = await acquireSemaphore(key, 1, 120000);
  if (t1 === null) return;
  const t2 = await acquireSemaphore(key, 1, 120000);
  assert.equal(t2, null);
  await releaseSemaphore(key, t1);
});
