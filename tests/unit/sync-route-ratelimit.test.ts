import test from 'node:test';
import assert from 'node:assert/strict';

import { RateLimitService } from '@/lib/services/rate-limit-service';
import { extractSiteIdForRateLimit } from '@/app/api/sync/route';

test('extractSiteIdForRateLimit: single payload body.s', () => {
  assert.equal(extractSiteIdForRateLimit({ s: 'site-abc', url: '/' }), 'site-abc');
  assert.equal(extractSiteIdForRateLimit({ s: '  trim  ' }), 'trim');
  assert.equal(extractSiteIdForRateLimit({ s: '' }), null);
  assert.equal(extractSiteIdForRateLimit({ s: 123 }), null);
  assert.equal(extractSiteIdForRateLimit(null), null);
  assert.equal(extractSiteIdForRateLimit({}), null);
});

test('extractSiteIdForRateLimit: batch events[0].s', () => {
  assert.equal(
    extractSiteIdForRateLimit({ events: [{ s: 'site-batch', url: '/' }] }),
    'site-batch'
  );
  assert.equal(
    extractSiteIdForRateLimit({ events: [{ s: '  b  ' }] }),
    'b'
  );
  assert.equal(extractSiteIdForRateLimit({ events: [] }), null);
  assert.equal(extractSiteIdForRateLimit({ events: [{}] }), null);
});

test('sync rate limit: same IP+UA + different siteId => two buckets, both allowed under load', async () => {
  const counts = new Map<string, number>();
  const expiresAt = new Map<string, number>();
  const fakeRedis = {
    incr: async (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    pexpire: async (key: string, ms: number) => {
      expiresAt.set(key, Date.now() + ms);
      return true;
    },
    pttl: async (key: string) => {
      const ea = expiresAt.get(key);
      if (!ea) return -1;
      return Math.max(-1, ea - Date.now());
    },
  };
  RateLimitService._setRedisForTests(fakeRedis as Parameters<typeof RateLimitService._setRedisForTests>[0]);

  const clientId = '1.2.3.4|Mozilla/5.0';
  const limit = 100;
  const windowMs = 60000;

  const keyA = `site-poyraz:${clientId}`;
  const keyB = `site-other:${clientId}`;

  for (let i = 0; i < 80; i++) {
    const r = await RateLimitService.check(keyA, limit, windowMs);
    assert.equal(r.allowed, true, `site-poyraz request ${i + 1} should be allowed`);
  }
  for (let i = 0; i < 80; i++) {
    const r = await RateLimitService.check(keyB, limit, windowMs);
    assert.equal(r.allowed, true, `site-other request ${i + 1} should be allowed`);
  }

  assert.equal(counts.get('ratelimit:site-poyraz:1.2.3.4|Mozilla/5.0'), 80);
  assert.equal(counts.get('ratelimit:site-other:1.2.3.4|Mozilla/5.0'), 80);
});
