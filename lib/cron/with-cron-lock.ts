/**
 * Distributed cron lock (mutex) via Redis SET NX EX.
 * Prevents overlapping runs when a cron takes longer than its interval.
 * If lock cannot be acquired, return early with { skipped: true, reason: 'lock_held' }.
 */

import { redis } from '@/lib/upstash';

const LOCK_PREFIX = 'cron:lock:';

/**
 * Try to acquire a distributed lock for the cron job.
 * Uses Redis SET key value NX EX ttlSeconds — atomic, auto-expiring.
 * @param cronPath - e.g. 'process-offline-conversions' (used as key suffix)
 * @param ttlSeconds - Lock TTL in seconds. Should exceed typical run duration (e.g. 660 for 10-min cron)
 * @returns true if lock acquired, false if already held
 */
export async function tryAcquireCronLock(
  cronPath: string,
  ttlSeconds: number
): Promise<boolean> {
  const key = `${LOCK_PREFIX}${cronPath}`;
  const value = `${Date.now()}`;
  try {
    const result = await redis.set(key, value, {
      nx: true,
      ex: ttlSeconds,
    });
    return result === 'OK';
  } catch {
    // Redis unavailable — fail closed: treat as lock held to avoid duplicate work
    return false;
  }
}

/**
 * Release the lock (best-effort). Lock auto-expires via TTL; release allows earlier reuse.
 */
export async function releaseCronLock(cronPath: string): Promise<void> {
  const key = `${LOCK_PREFIX}${cronPath}`;
  try {
    await redis.del(key);
  } catch {
    // Best-effort; TTL will expire
  }
}
