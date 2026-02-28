/**
 * Fraud Quarantine Service — CRITICAL LOCKDOWN
 * Detects high-frequency/suspicious events (fingerprint-based) and routes to ingest_fraud_quarantine.
 * Uses Redis for fast sliding-window counting.
 */

import { redis } from '@/lib/upstash';
import { logError } from '@/lib/logging/logger';

/** Events per fingerprint in FRAUD_WINDOW_SEC before routing to quarantine. Env OPSMANTIK_FRAUD_FP_THRESHOLD. */
const FRAUD_FP_THRESHOLD = Math.max(50, parseInt(process.env.OPSMANTIK_FRAUD_FP_THRESHOLD ?? '80', 10) || 80);
/** Window seconds. Env OPSMANTIK_FRAUD_WINDOW_SEC. */
const FRAUD_WINDOW_SEC = Math.max(60, parseInt(process.env.OPSMANTIK_FRAUD_WINDOW_SEC ?? '120', 10) || 120);

export type FraudCheckResult = { quarantine: true; reason: string } | { quarantine: false };

/**
 * Check if this fingerprint has exceeded the high-frequency threshold.
 * INCR fraud:fp:{siteId}:{fingerprint}; EXPIRE on first incr.
 * If count > threshold after incr → quarantine.
 */
export async function checkAndIncrementFraudFingerprint(
    siteId: string,
    fingerprint: string,
    redisClient: { incr: (k: string) => Promise<number>; pexpire?: (k: string, ms: number) => Promise<unknown>; expire?: (k: string, s: number) => Promise<unknown> } | null = redis
): Promise<FraudCheckResult> {
    if (!fingerprint || fingerprint.trim().length === 0) {
        return { quarantine: false };
    }

    const key = `fraud:fp:${siteId}:${fingerprint}`;

    try {
        const r = redisClient;
        if (!r || typeof r.incr !== 'function') return { quarantine: false };

        const count = await r.incr(key);
        if (count === 1) {
            if (typeof r.pexpire === 'function') await r.pexpire(key, FRAUD_WINDOW_SEC * 1000);
            else if (typeof r.expire === 'function') await r.expire(key, FRAUD_WINDOW_SEC);
        }

        if (count > FRAUD_FP_THRESHOLD) {
            return { quarantine: true, reason: 'high_frequency_fingerprint' };
        }

        return { quarantine: false };
    } catch (err) {
        logError('fraud_quarantine_redis_error', { error: String((err as Error)?.message ?? err), siteId });
        return { quarantine: false };
    }
}
