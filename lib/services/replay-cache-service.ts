import { createHash } from 'node:crypto';

import { redis } from '@/lib/upstash';
import { logWarn } from '@/lib/logging/logger';

type RedisLike = {
  incr: (key: string) => Promise<number>;
  pexpire: (key: string, ms: number) => Promise<unknown>;
};

export class ReplayCacheService {
  // Best-effort local fallback for degraded mode.
  private static localKeys = new Map<string, number>(); // key -> expiresAtMs
  // Test seam
  private static redisClient: RedisLike | null = redis;

  static _setRedisForTests(r: RedisLike | null) {
    ReplayCacheService.redisClient = r;
  }

  static _resetForTests() {
    ReplayCacheService.localKeys.clear();
  }

  /**
   * Builds replay cache key. Prefer sha256(signature) when available to prevent replay bypass
   * via client-generated eventId. Same signed payload → same key → replay detected.
   */
  static makeReplayKey(input: { siteId: string; eventId?: string | null; signature?: string | null }): string {
    const token = input.signature
      ? createHash('sha256').update(input.signature, 'utf8').digest('hex')
      : input.eventId
        ? `e:${input.eventId}`
        : 'none';
    const raw = `${input.siteId}:${token}`;
    const h = createHash('sha256').update(raw, 'utf8').digest('hex');
    return h;
  }

  static async checkAndStore(
    key: string,
    ttlMs: number,
    opts?: { mode?: 'degraded' | 'fail-closed'; namespace?: string }
  ): Promise<{ isReplay: boolean; degraded: boolean }> {
    const mode = opts?.mode ?? 'degraded';
    const ns = opts?.namespace ? `${opts.namespace}:` : '';
    const k = `replay:${ns}${key.replace(/^replay:/, '')}`;
    const now = Date.now();

    try {
      const r = ReplayCacheService.redisClient as RedisLike | null;
      if (!r) throw new Error('redis_unavailable');

      const count = await r.incr(k);
      if (count === 1) {
        await r.pexpire(k, ttlMs);
      }
      return { isReplay: count > 1, degraded: false };
    } catch (e) {
      logWarn('replay-cache redis error', { error: String((e as Error)?.message ?? e), mode });

      if (mode === 'fail-closed') {
        return { isReplay: true, degraded: true };
      }

      // degraded: local best-effort replay cache
      const exp = ReplayCacheService.localKeys.get(k);
      if (exp && exp > now) {
        return { isReplay: true, degraded: true };
      }
      ReplayCacheService.localKeys.set(k, now + ttlMs);
      return { isReplay: false, degraded: true };
    }
  }
}

