import { redis } from '@/lib/upstash';

/**
 * Enterprise Rate Limit Service (Distributed via Upstash Redis)
 */
export class RateLimitService {
    static async check(
        clientId: string,
        maxRequests: number,
        windowMs: number
    ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
        const key = `ratelimit:${clientId}`;
        const now = Date.now();

        try {
            const count = await redis.incr(key);

            if (count === 1) {
                await redis.pexpire(key, windowMs);
            }

            const ttl = await redis.pttl(key);
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
            console.error('[RATELIMIT_ERROR]', error);
            // Fail open in case of Redis failure to maintain service availability
            return { allowed: true, remaining: 1, resetAt: now + windowMs };
        }
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
