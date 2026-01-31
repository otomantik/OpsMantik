/**
 * Enterprise Rate Limit Service (Distributed-ready)
 * Current: In-memory store
 * Future: Easily swap with Redis by updating the adapter.
 */
export class RateLimitService {
    private static store: Map<string, { count: number; resetAt: number }> = new Map();

    static async check(
        clientId: string,
        maxRequests: number,
        windowMs: number
    ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
        const now = Date.now();
        const key = clientId;

        let bucket = this.store.get(key);

        if (!bucket || now > bucket.resetAt) {
            bucket = {
                count: 1,
                resetAt: now + windowMs,
            };
            this.store.set(key, bucket);
            return {
                allowed: true,
                remaining: maxRequests - 1,
                resetAt: bucket.resetAt,
            };
        }

        if (bucket.count >= maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                resetAt: bucket.resetAt,
            };
        }

        bucket.count++;
        this.store.set(key, bucket);

        return {
            allowed: true,
            remaining: maxRequests - bucket.count,
            resetAt: bucket.resetAt,
        };
    }

    static getClientId(req: Request): string {
        const forwarded = req.headers.get('x-forwarded-for');
        const ip = forwarded ? forwarded.split(',')[0] : 'unknown';
        return ip;
    }
}
