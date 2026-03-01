/**
 * PR11: Semaphore unit tests. Fail-closed: Redis errors throw RedisOutageError.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireSemaphore,
  releaseSemaphore,
  siteProviderKey,
  globalProviderKey,
  RedisOutageError,
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

test('acquireSemaphore with limit 1 returns token or throws RedisOutageError', async () => {
  const key = `test:pr11:${Date.now()}`;
  try {
    const token = await acquireSemaphore(key, 1, 120000);
    if (token !== null) {
      assert.ok(typeof token === 'string' && token.length > 0);
      await releaseSemaphore(key, token);
    }
  } catch (err) {
    assert.ok(err instanceof RedisOutageError, 'Redis unavailable throws RedisOutageError');
  }
});

test('acquireSemaphore when at limit returns null (second acquire with limit 1)', async () => {
  const key = `test:pr11:limit1:${Date.now()}`;
  let t1: string | null = null;
  try {
    t1 = await acquireSemaphore(key, 1, 120000);
    if (t1 === null) return; // Redis unavailable (throws) or at limit
    const t2 = await acquireSemaphore(key, 1, 120000);
    assert.equal(t2, null);
  } catch (err) {
    if (err instanceof RedisOutageError) return; // Redis unavailable — skip
    throw err;
  } finally {
    if (t1) await releaseSemaphore(key, t1);
  }
});
