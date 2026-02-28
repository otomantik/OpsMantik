import { redis } from '@/lib/upstash';
import { logError } from '@/lib/logging/logger';
import { getClientIp } from '@/lib/request-client-ip';

/** Sprint 3: Max concurrent heavy read operations per site (reporting). Override with HEAVY_READ_MAX_CONCURRENT_PER_SITE. */
const HEAVY_READ_MAX_CONCURRENT = Math.max(1, parseInt(process.env.HEAVY_READ_MAX_CONCURRENT_PER_SITE ?? '5', 10) || 5);
/** TTL for heavy-read key so a crashed process doesn't leak the slot forever. */
const HEAVY_READ_KEY_TTL_SEC = 300;

/**
 * Enterprise Rate Limit Service (Distributed via Upstash Redis)
 */
export class RateLimitService {
    // In-memory fallback for degraded mode (best-effort per instance).
    private static localBuckets = new Map<string, { count: number; resetAt: number }>();
    // Test seam
    private static redisClient: {
        incr: (k: string) => Promise<number>;
        pexpire: (k: string, ms: number) => Promise<boolean | number | unknown>;
        pttl: (k: string) => Promise<number>
    } | null = redis;

    static _setRedisForTests(r: {
        incr: (k: string) => Promise<number>;
        pexpire: (k: string, ms: number) => Promise<boolean | number | unknown>;
        pttl: (k: string) => Promise<number>
    } | null) {
        RateLimitService.redisClient = r;
    }

    static async checkWithMode(
        clientId: string,
        maxRequests: number,
        windowMs: number,
        opts?: { mode?: 'fail-open' | 'fail-closed' | 'degraded'; namespace?: string; fallbackMaxRequests?: number }
    ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
        const mode = opts?.mode ?? (process.env.OPSMANTIK_RATE_LIMIT_FAIL_MODE as 'fail-open' | 'fail-closed' | 'degraded') ?? 'fail-closed';
        const ns = opts?.namespace ? `${opts.namespace}:` : '';
        const key = `ratelimit:${ns}${clientId}`;
        const now = Date.now();

        try {
            const r = RateLimitService.redisClient;
            if (!r) throw new Error('redis_unavailable');

            const count = await r.incr(key);

            if (count === 1) {
                await r.pexpire(key, windowMs);
            }

            const ttl = await r.pttl(key);
            const resetAt = now + (ttl > 0 ? ttl : windowMs);

            if (count > maxRequests) {
                return {
                    allowed: false,
                    remaining: 0,
                    resetAt,
                };
            }

            return {
                allowed: true,
                remaining: Math.max(0, maxRequests - count),
                resetAt,
            };
        } catch (error) {
            // No console noise in prod paths; structured logger only.
            logError('ratelimit redis error', { error: String((error as Error)?.message ?? error), mode });

            if (mode === 'fail-open') {
                return { allowed: true, remaining: 1, resetAt: now + windowMs };
            }

            if (mode === 'fail-closed') {
                return { allowed: false, remaining: 0, resetAt: now + windowMs };
            }

            // degraded: strict best-effort local limiter with lower limits
            const fallbackMax = Math.max(1, Math.floor(opts?.fallbackMaxRequests ?? Math.max(1, Math.floor(maxRequests / 5))));
            const bucket = RateLimitService.localBuckets.get(key);
            if (!bucket || bucket.resetAt <= now) {
                // New window
                const resetAt = now + windowMs;
                RateLimitService.localBuckets.set(key, { count: 1, resetAt });
                return { allowed: true, remaining: Math.max(0, fallbackMax - 1), resetAt };
            }

            bucket.count += 1;
            RateLimitService.localBuckets.set(key, bucket);
            if (bucket.count > fallbackMax) {
                return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
            }

            return { allowed: true, remaining: Math.max(0, fallbackMax - bucket.count), resetAt: bucket.resetAt };
        }
    }

    static async check(
        clientId: string,
        maxRequests: number,
        windowMs: number
    ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
        // CRITICAL LOCKDOWN: Ingest paths use fail-closed. Protect DB when Redis is down.
        const mode = (process.env.OPSMANTIK_RATE_LIMIT_FAIL_MODE as 'fail-open' | 'fail-closed' | 'degraded') ?? 'fail-closed';
        return RateLimitService.checkWithMode(clientId, maxRequests, windowMs, { mode });
    }

    static getClientId(req: Request): string {
        // Multi-tenant/proxy (e.g. SST): trust x-forwarded-for (first) then x-real-ip so real client IP is used.
        const ip = getClientIp(req) ?? 'unknown';

        // NAT mitigation: include a small UA slice so one office IP doesn't instantly block everyone.
        const ua = req.headers.get('user-agent') || '';
        const uaKey = ua.trim().slice(0, 64);

        return `${ip}|${uaKey}`;
    }

    /**
     * Sprint 3: Noisy-neighbor protection — concurrency limit per site for heavy read (reporting) operations.
     * Use before running dashboard stats / complex reports; call release() when done.
     * If allowed is false, return 429 to the client and do not run the report.
     */
    static async tryAcquireHeavyRead(siteId: string): Promise<{ allowed: boolean; release: () => Promise<void> }> {
        const key = `heavyread:${siteId}`;
        try {
            const r = RateLimitService.redisClient as { incr: (k: string) => Promise<number>; decr: (k: string) => Promise<number>; expire: (k: string, s: number) => Promise<unknown> } | null;
            if (!r || typeof r.incr !== 'function' || typeof r.decr !== 'function') {
                return { allowed: true, release: async () => {} };
            }
            const count = await r.incr(key);
            if (count === 1) await r.expire?.(key, HEAVY_READ_KEY_TTL_SEC);
            if (count > HEAVY_READ_MAX_CONCURRENT) {
                await r.decr(key);
                return { allowed: false, release: async () => {} };
            }
            return {
                allowed: true,
                release: async () => {
                    try {
                        await r.decr(key);
                    } catch {
                        // best-effort
                    }
                },
            };
        } catch (err) {
            logError('heavy_read_redis_error', { error: String((err as Error)?.message ?? err), siteId });
            return { allowed: true, release: async () => {} };
        }
    }
}
