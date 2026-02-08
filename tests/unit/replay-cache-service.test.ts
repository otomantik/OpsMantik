import { afterEach, test, expect } from 'vitest';

import { ReplayCacheService } from '@/lib/services/replay-cache-service';

afterEach(() => {
  ReplayCacheService._resetForTests();
});

function makeFakeRedis() {
  const counts = new Map<string, number>();
  return {
    incr: async (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    pexpire: async () => 'OK',
  };
}

test('ReplayCacheService.checkAndStore: redis path blocks second use', async () => {
  ReplayCacheService._resetForTests();
  ReplayCacheService._setRedisForTests(makeFakeRedis());

  const key = ReplayCacheService.makeReplayKey({ siteId: 's1', eventId: '00000000-0000-0000-0000-000000000000' });
  const a = await ReplayCacheService.checkAndStore(key, 60_000, { mode: 'degraded', namespace: 't' });
  const b = await ReplayCacheService.checkAndStore(key, 60_000, { mode: 'degraded', namespace: 't' });

  expect(a.isReplay).toBe(false);
  expect(b.isReplay).toBe(true);
  expect(a.degraded).toBe(false);
});

test('ReplayCacheService.checkAndStore: degraded local fallback blocks second use on redis error', async () => {
  ReplayCacheService._resetForTests();
  ReplayCacheService._setRedisForTests({
    incr: async () => {
      throw new Error('redis down');
    },
    pexpire: async () => 'OK',
  });

  const key = ReplayCacheService.makeReplayKey({ siteId: 's2', signature: 'deadbeef' });
  const a = await ReplayCacheService.checkAndStore(key, 60_000, { mode: 'degraded', namespace: 't' });
  const b = await ReplayCacheService.checkAndStore(key, 60_000, { mode: 'degraded', namespace: 't' });

  expect(a.isReplay).toBe(false);
  expect(b.isReplay).toBe(true);
  expect(a.degraded).toBe(true);
  expect(b.degraded).toBe(true);
});

