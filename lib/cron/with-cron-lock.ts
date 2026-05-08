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

export type CronLockBackend = 'lease' | 'redis' | 'db_fallback';
export type CronLockAcquireReason =
  | 'acquired'
  | 'lock_held'
  | 'lock_backend_unavailable'
  | 'lock_rpc_missing'
  | 'lock_acquire_error';

export type CronLockAcquireResult = {
  acquired: boolean;
  reason: CronLockAcquireReason;
  backend: CronLockBackend;
  lock_path: string;
  ttl_seconds: number;
  error_code?: string;
};

function classifyRpcError(errorMessage: string | undefined): Pick<CronLockAcquireResult, 'reason' | 'error_code'> {
  const msg = String(errorMessage ?? '');
  const lower = msg.toLowerCase();
  if (lower.includes('does not exist') || lower.includes('function') || lower.includes('42883')) {
    return { reason: 'lock_rpc_missing', error_code: 'RPC_MISSING' };
  }
  return { reason: 'lock_acquire_error', error_code: 'RPC_ERROR' };
}

async function tryAcquireRedisOrAdvisoryFallbackDetailed(
  key: string,
  ttlSeconds: number
): Promise<CronLockAcquireResult> {
  const value = `${key}:${ttlSeconds}`;
  try {
    const result = await redis.set(key, value, {
      nx: true,
      ex: ttlSeconds,
    });
    if (result === 'OK') {
      return { acquired: true, reason: 'acquired', backend: 'redis', lock_path: key, ttl_seconds: ttlSeconds };
    }
    return { acquired: false, reason: 'lock_held', backend: 'redis', lock_path: key, ttl_seconds: ttlSeconds };
  } catch (redisError) {
    const { data, error } = await adminClient.rpc('try_acquire_cron_lock_v1', {
      p_lock_key: key,
    });
    if (error) {
      const classified = classifyRpcError(error.message);
      return {
        acquired: false,
        reason: classified.reason,
        backend: 'db_fallback',
        lock_path: key,
        ttl_seconds: ttlSeconds,
        error_code: classified.error_code,
      };
    }
    if (data === true) {
      return { acquired: true, reason: 'acquired', backend: 'db_fallback', lock_path: key, ttl_seconds: ttlSeconds };
    }
    return {
      acquired: false,
      reason: 'lock_held',
      backend: 'db_fallback',
      lock_path: key,
      ttl_seconds: ttlSeconds,
      error_code: redisError instanceof Error ? 'REDIS_SET_FAILED_FALLBACK_LOCK_HELD' : 'REDIS_SET_FAILED_FALLBACK_LOCK_HELD',
    };
  }
}

async function tryAcquireLeaseLockDetailed(key: string, ttlSeconds: number): Promise<CronLockAcquireResult> {
  const owner = crypto.randomUUID();
  const acquire = await adminClient.rpc('acquire_cron_lease_v1', {
    p_lock_name: key,
    p_owner_token: owner,
    p_ttl_seconds: ttlSeconds,
  });
  if (acquire.error) {
    const classified = classifyRpcError(acquire.error.message);
    return {
      acquired: false,
      reason: classified.reason,
      backend: 'lease',
      lock_path: key,
      ttl_seconds: ttlSeconds,
      error_code: classified.error_code,
    };
  }
  let acquired = acquire.data === true;
  if (!acquired) {
    const steal = await adminClient.rpc('steal_expired_cron_lease_v1', {
      p_lock_name: key,
      p_owner_token: owner,
      p_ttl_seconds: ttlSeconds,
      p_grace_seconds: 10,
    });
    if (!steal.error && steal.data === true) {
      acquired = true;
      incrementRefactorMetric('lease_steal_total');
    } else if (steal.error) {
      const classified = classifyRpcError(steal.error.message);
      return {
        acquired: false,
        reason: classified.reason,
        backend: 'lease',
        lock_path: key,
        ttl_seconds: ttlSeconds,
        error_code: classified.error_code,
      };
    }
  }
  if (acquired) {
    leaseOwners.set(key, owner);
    incrementRefactorMetric('lease_acquire_success');
    return { acquired: true, reason: 'acquired', backend: 'lease', lock_path: key, ttl_seconds: ttlSeconds };
  }
  incrementRefactorMetric('lease_acquire_denied');
  return { acquired: false, reason: 'lock_held', backend: 'lease', lock_path: key, ttl_seconds: ttlSeconds };
}

export function startCronLockHeartbeat(cronPath: string, ttlSeconds: number): (() => void) | null {
  if (getRefactorFlags().lease_lock_mode !== 'lease') return null;
  const key = `${LOCK_PREFIX}${cronPath}`;
  const owner = leaseOwners.get(key);
  if (!owner) return null;
  const intervalMs = Math.max(5_000, Math.floor((ttlSeconds * 1000) / 3));
  const nowMs = () => new Date().getTime();
  let nextTickAt = nowMs() + intervalMs;
  const timer = setInterval(async () => {
    const lagMs = Math.max(0, nowMs() - nextTickAt);
    nextTickAt = nowMs() + intervalMs;
    const hb = await adminClient.rpc('heartbeat_cron_lease_v1', {
      p_lock_name: key,
      p_owner_token: owner,
      p_ttl_seconds: ttlSeconds,
    });
    if (hb.error || hb.data !== true) {
      logWarn('cron_lease_heartbeat_failed', {
        lock_name: key,
        owner_token: owner,
        error: hb.error?.message ?? 'heartbeat_not_acknowledged',
      });
      return;
    }
    incrementRefactorMetric('lease_heartbeat_lag_ms', lagMs);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
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
  const detailed = await tryAcquireCronLockDetailed(cronPath, ttlSeconds);
  return detailed.acquired;
}

export async function tryAcquireCronLockDetailed(
  cronPath: string,
  ttlSeconds: number
): Promise<CronLockAcquireResult> {
  const key = `${LOCK_PREFIX}${cronPath}`;
  const { lease_lock_mode } = getRefactorFlags();

  if (lease_lock_mode === 'lease') {
    return tryAcquireLeaseLockDetailed(key, ttlSeconds);
  }

  const acquired = await tryAcquireRedisOrAdvisoryFallbackDetailed(key, ttlSeconds);

  if (lease_lock_mode === 'shadow') {
    const shadowAcquired = await tryAcquireLeaseLockDetailed(key, ttlSeconds);
    if (shadowAcquired.acquired) {
      const owner = leaseOwners.get(key);
      if (owner) {
        await adminClient.rpc('release_cron_lease_v1', {
          p_lock_name: key,
          p_owner_token: owner,
        });
        leaseOwners.delete(key);
      }
    }
    if (acquired.acquired !== shadowAcquired.acquired) {
      logWarn('cron_lock_shadow_mismatch', {
        lock_name: key,
        legacy_acquired: acquired.acquired,
        lease_shadow_acquired: shadowAcquired.acquired,
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
  } catch (error) {
    // Best-effort; TTL will expire, but keep an audit breadcrumb.
    logWarn('cron_lock_release_failed', {
      lock_name: key,
      error: String((error as Error)?.message ?? error ?? 'unknown_error'),
    });
  }
}
