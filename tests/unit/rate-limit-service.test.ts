import test from 'node:test';
import assert from 'node:assert/strict';

import { RateLimitService } from '@/lib/services/rate-limit-service';

function makeFakeRedis() {
  const counts = new Map<string, number>();
  const expiresAt = new Map<string, number>();
  return {
    incr: async (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    pexpire: async (key: string, ms: number) => {
      expiresAt.set(key, Date.now() + ms);
      return 'OK';
    },
    pttl: async (key: string) => {
      const ea = expiresAt.get(key);
      if (!ea) return -1;
      return Math.max(-1, ea - Date.now());
    },
  };
}

test('RateLimitService.checkWithMode: fail-open allows on redis error', async () => {
  RateLimitService._setRedisForTests({
    incr: async () => {
      throw new Error('redis down');
    },
    pexpire: async () => {},
    pttl: async () => -1,
  });

  const res = await RateLimitService.checkWithMode('c1', 1, 1000, { mode: 'fail-open', namespace: 't' });
  assert.equal(res.allowed, true);
});

test('RateLimitService.checkWithMode: fail-closed denies on redis error', async () => {
  RateLimitService._setRedisForTests({
    incr: async () => {
      throw new Error('redis down');
    },
    pexpire: async () => {},
    pttl: async () => -1,
  });

  const res = await RateLimitService.checkWithMode('c2', 1, 1000, { mode: 'fail-closed', namespace: 't' });
  assert.equal(res.allowed, false);
});

test('RateLimitService.checkWithMode: degraded uses local fallback with lower limits', async () => {
  RateLimitService._setRedisForTests({
    incr: async () => {
      throw new Error('redis down');
    },
    pexpire: async () => {},
    pttl: async () => -1,
  });

  const cid = `c3-${Date.now()}`;
  const a = await RateLimitService.checkWithMode(cid, 50, 60_000, { mode: 'degraded', namespace: 't', fallbackMaxRequests: 2 });
  const b = await RateLimitService.checkWithMode(cid, 50, 60_000, { mode: 'degraded', namespace: 't', fallbackMaxRequests: 2 });
  const c = await RateLimitService.checkWithMode(cid, 50, 60_000, { mode: 'degraded', namespace: 't', fallbackMaxRequests: 2 });

  assert.equal(a.allowed, true);
  assert.equal(b.allowed, true);
  assert.equal(c.allowed, false);
});

test('RateLimitService.checkWithMode: normal redis path enforces maxRequests', async () => {
  const fake = makeFakeRedis();
  RateLimitService._setRedisForTests(fake);

  const cid = `c4-${Date.now()}`;
  const r1 = await RateLimitService.checkWithMode(cid, 2, 60_000, { mode: 'fail-closed', namespace: 't' });
  const r2 = await RateLimitService.checkWithMode(cid, 2, 60_000, { mode: 'fail-closed', namespace: 't' });
  const r3 = await RateLimitService.checkWithMode(cid, 2, 60_000, { mode: 'fail-closed', namespace: 't' });

  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, false);
});

