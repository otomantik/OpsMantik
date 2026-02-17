/**
 * PR11: Redis semaphore for provider upload concurrency (per site+provider / global).
 * ZSET: member=token, score=expiresAtMs. Lua scripts for race-safe acquire/release.
 * TTL purge on acquire so stuck tokens (crashed worker) don't hold slots.
 */

import { redis } from '@/lib/upstash';

const ACQUIRE_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  local n = redis.call('ZCARD', KEYS[1])
  if n < tonumber(ARGV[2]) then
    redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
    return ARGV[4]
  end
  return nil
`;

const RELEASE_SCRIPT = `
  redis.call('ZREM', KEYS[1], ARGV[1])
  return 1
`;

/**
 * Acquire one slot. Purges expired (score < now), then if count < limit adds token with score=now+ttlMs.
 * @returns token (uuid) or null if at limit or Redis error (fail-open: null = skip upload, treat as CONCURRENCY_LIMIT)
 */
export async function acquireSemaphore(
  key: string,
  limit: number,
  ttlMs: number
): Promise<string | null> {
  if (limit < 1) return null;
  const nowMs = Date.now();
  const token = crypto.randomUUID();
  const expiresAtMs = String(nowMs + ttlMs);
  try {
    const result = await redis.eval(
      ACQUIRE_SCRIPT,
      [key],
      [String(nowMs), String(limit), expiresAtMs, token]
    );
    return result === token ? token : null;
  } catch {
    return null;
  }
}

/**
 * Release one slot by removing the token from the ZSET.
 */
export async function releaseSemaphore(key: string, token: string): Promise<void> {
  try {
    await redis.eval(RELEASE_SCRIPT, [key], [token]);
  } catch {
    // Best-effort; TTL will purge if release fails (e.g. Redis down)
  }
}

/** Key for per-site+provider concurrency. */
export function siteProviderKey(siteId: string, providerKey: string): string {
  return `conc:${siteId}:${providerKey}`;
}

/** Key for global per-provider concurrency. */
export function globalProviderKey(providerKey: string): string {
  return `conc:global:${providerKey}`;
}
