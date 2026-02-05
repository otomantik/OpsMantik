import { redis } from '@/lib/upstash';
import { DEFAULT_TIMEZONE, getTodayDateKey } from '@/lib/time/today-range';

export class StatsService {
    private static getTodayKey(timezone: string = DEFAULT_TIMEZONE): string {
        return getTodayDateKey(timezone);
    }

    private static getBaseKey(siteId: string, dateStr?: string, timezone: string = DEFAULT_TIMEZONE): string {
        const date = dateStr || this.getTodayKey(timezone);
        return `stats:${siteId}:${date}`;
    }

    /**
     * Atomically increment captured intents
     */
    static async incrementCaptured(siteId: string, isGclid: boolean = false, timezone: string = DEFAULT_TIMEZONE) {
        const key = this.getBaseKey(siteId, undefined, timezone);
        const pipeline = redis.pipeline();

        pipeline.hincrby(key, 'captured', 1);
        if (isGclid) {
            pipeline.hincrby(key, 'gclid', 1);
        }

        // TTL for stats (7 days is enough for recent view)
        pipeline.expire(key, 60 * 60 * 24 * 7);

        await pipeline.exec();
    }

    /**
     * Increment junk filter count
     */
    static async incrementJunk(siteId: string, timezone: string = DEFAULT_TIMEZONE) {
        const key = this.getBaseKey(siteId, undefined, timezone);
        await redis.hincrby(key, 'junk', 1);
    }

    /**
     * Fetch real-time stats from Redis
     */
    static async getRealtimeStats(siteId: string, dateStr?: string, timezone: string = DEFAULT_TIMEZONE) {
        const key = this.getBaseKey(siteId, dateStr, timezone);
        const data = await redis.hgetall(key);

        if (!data) return { captured: 0, gclid: 0, junk: 0 };

        return {
            captured: parseInt(String(data.captured || 0)),
            gclid: parseInt(String(data.gclid || 0)),
            junk: parseInt(String(data.junk || 0))
        };
    }
}
