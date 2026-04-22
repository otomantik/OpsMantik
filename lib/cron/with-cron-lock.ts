/**
 * Distributed cron lock (mutex) via Redis SET NX EX.
 * Prevents overlapping runs when a cron takes longer than its interval.
 * If lock cannot be acquired, return early with { skipped: true, reason: 'lock_held' }.
 */

import { redis } from '@/lib/upstash';
import { adminClient } from '@/lib/supabase/admin';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { logWarn } from '@/lib/logging/logger';

const LOCK_PREFIX = 'cron:lock:';
const leaseOwners = new Map<string, string>();

async function tryAcquireRedisOrAdvisoryFallback(key: string, ttlSeconds: number): Promise<boolean> {
  const value = `${key}:${ttlSeconds}`;
  try {
    const result = await redis.set(key, value, {
      nx: true,
      ex: ttlSeconds,
    });
    return result === 'OK';
  } catch {
    const { data, error } = await adminClient.rpc('try_acquire_cron_lock_v1', {
      p_lock_key: key,
    });
    if (error) return false;
    return data === true;
  }
}

async function tryAcquireLeaseLock(key: string, ttlSeconds: number): Promise<boolean> {
  const owner = crypto.randomUUID();
  const { data, error } = await adminClient.rpc('acquire_cron_lease_v1', {
    p_lock_name: key,
    p_owner_token: owner,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) return false;
  const acquired = data === true;
  if (acquired) {
    leaseOwners.set(key, owner);
    incrementRefactorMetric('lease_acquire_success');
  } else {
    incrementRefactorMetric('lease_acquire_denied');
  }
  return acquired;
}

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
  const { lease_lock_mode } = getRefactorFlags();

  if (lease_lock_mode === 'lease') {
    return tryAcquireLeaseLock(key, ttlSeconds);
  }

  const acquired = await tryAcquireRedisOrAdvisoryFallback(key, ttlSeconds);

  if (lease_lock_mode === 'shadow') {
    const shadowAcquired = await tryAcquireLeaseLock(key, ttlSeconds);
    if (shadowAcquired) {
      const owner = leaseOwners.get(key);
      if (owner) {
        await adminClient.rpc('release_cron_lease_v1', {
          p_lock_name: key,
          p_owner_token: owner,
        });
        leaseOwners.delete(key);
      }
    }
    if (acquired !== shadowAcquired) {
      logWarn('cron_lock_shadow_mismatch', {
        lock_name: key,
        legacy_acquired: acquired,
        lease_shadow_acquired: shadowAcquired,
      });
    }
  }

  return acquired;
}

/**
 * Release the lock (best-effort). Lock auto-expires via TTL; release allows earlier reuse.
 */
export async function releaseCronLock(cronPath: string): Promise<void> {
  const key = `${LOCK_PREFIX}${cronPath}`;
  const { lease_lock_mode } = getRefactorFlags();
  if (lease_lock_mode === 'lease') {
    const owner = leaseOwners.get(key);
    if (!owner) return;
    await adminClient.rpc('release_cron_lease_v1', {
      p_lock_name: key,
      p_owner_token: owner,
    });
    leaseOwners.delete(key);
    return;
  }

  try {
    await redis.del(key);
  } catch {
    // Best-effort; TTL will expire
  }
}
