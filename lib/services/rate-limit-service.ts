import { redis } from '@/lib/upstash';
import { logError } from '@/lib/logging/logger';

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
        const mode = opts?.mode ?? 'fail-open';
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
        // Backwards compatible default: fail-open, no namespace.
        return RateLimitService.checkWithMode(clientId, maxRequests, windowMs, { mode: 'fail-open' });
    }

    static getClientId(req: Request): string {
        // Prefer edge/CDN headers to avoid masking real client IP.
        // Cloudflare: cf-connecting-ip is the true client IP.
        const cfIp = req.headers.get('cf-connecting-ip');
        const xff = req.headers.get('x-forwarded-for');
        const xRealIp = req.headers.get('x-real-ip');
        const trueClientIp = req.headers.get('true-client-ip');

        const ip =
            (cfIp && cfIp.trim()) ||
            (xff && xff.split(',')[0]?.trim()) ||
            (xRealIp && xRealIp.trim()) ||
            (trueClientIp && trueClientIp.trim()) ||
            'unknown';

        // NAT mitigation: include a small UA slice so one office IP doesn't instantly block everyone.
        const ua = req.headers.get('user-agent') || '';
        const uaKey = ua.trim().slice(0, 64);

        return `${ip}|${uaKey}`;
    }
}
