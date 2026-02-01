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
        const forwarded = req.headers.get('x-forwarded-for');
        const ip = forwarded ? forwarded.split(',')[0] : 'unknown';
        return ip;
    }
}
