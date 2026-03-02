/**
 * PR-8: Billing observability — in-memory + Redis (persistent) counters.
 * Ingest path: INCR to both in-memory and Redis (best-effort). GET /api/metrics reads from Redis when available for cross-instance totals.
 */

import { logInfo } from '@/lib/logging/logger';
import { redis } from '@/lib/upstash';

const BILLING_REDIS_PREFIX = 'billing:';

const counterNames = [
  'billing_ingest_allowed_total',
  'billing_ingest_duplicate_total',
  'billing_ingest_rejected_quota_total',
  'billing_ingest_rate_limited_total',
  'billing_ingest_overage_total',
  'billing_ingest_degraded_total',
  'billing_reconciliation_runs_ok_total',
  'billing_reconciliation_runs_failed_total',
] as const;

const counters: Record<string, number> = Object.fromEntries(counterNames.map((k) => [k, 0]));

function redisKey(metric: string): string {
  return BILLING_REDIS_PREFIX + metric;
}

const BILLING_COUNTER_TTL_SEC = 365 * 24 * 60 * 60; // 1 year

function emit(metric: string, value: number = 1): void {
  counters[metric] = (counters[metric] ?? 0) + value;
  logInfo('BILLING_METRIC', { metric, value, total: counters[metric] });
  const key = redisKey(metric);
  redis
    .pipeline()
    .incr(key)
    .expire(key, BILLING_COUNTER_TTL_SEC)
    .exec()
    .catch(() => { /* best-effort; do not fail request */ });
}

export function incrementBillingIngestAllowed(): void {
  emit('billing_ingest_allowed_total');
}

export function incrementBillingIngestDuplicate(): void {
  emit('billing_ingest_duplicate_total');
}

export function incrementBillingIngestRejectedQuota(): void {
  emit('billing_ingest_rejected_quota_total');
}

export function incrementBillingIngestRateLimited(): void {
  emit('billing_ingest_rate_limited_total');
}

export function incrementBillingIngestOverage(): void {
  emit('billing_ingest_overage_total');
}

export function incrementBillingIngestDegraded(): void {
  emit('billing_ingest_degraded_total');
}

export function incrementBillingReconciliationRunOk(): void {
  emit('billing_reconciliation_runs_ok_total');
}

export function incrementBillingReconciliationRunFailed(): void {
  emit('billing_reconciliation_runs_failed_total');
}

/** Sync: in-memory only (per-instance). Use getBillingMetricsFromRedis for cross-instance totals. */
export function getBillingMetrics(): Record<string, number> {
  return { ...counters };
}

/**
 * Async: read billing counters from Redis (persistent, cross-instance). Falls back to null if Redis unavailable.
 * GET /api/metrics uses this as the primary source when available.
 */
export async function getBillingMetricsFromRedis(): Promise<Record<string, number> | null> {
  const keys = counterNames.map(redisKey);
  try {
    const values = await redis.mget(...keys);
    const out: Record<string, number> = {};
    counterNames.forEach((name, i) => {
      const v = values?.[i];
      const n = typeof v === 'number' ? v : Number(v);
      out[name] = Number.isFinite(n) ? n : 0;
    });
    return out;
  } catch {
    return null;
  }
}

/** Reset all counters (for tests only). Does not clear Redis. */
export function resetBillingMetrics(): void {
  for (const key of Object.keys(counters)) {
    counters[key] = 0;
  }
}
