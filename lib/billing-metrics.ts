/**
 * PR-8: Billing observability — in-memory counters + structured log emission.
 * Counters are per-instance (reset on cold start in serverless); also emit log lines for aggregation.
 */

import { logInfo } from '@/lib/logging/logger';

const counters: Record<string, number> = {
  billing_ingest_allowed_total: 0,
  billing_ingest_duplicate_total: 0,
  billing_ingest_rejected_quota_total: 0,
  billing_ingest_rate_limited_total: 0,
  billing_ingest_overage_total: 0,
  billing_ingest_degraded_total: 0,
  billing_reconciliation_runs_ok_total: 0,
  billing_reconciliation_runs_failed_total: 0,
};

function emit(metric: string, value: number = 1): void {
  counters[metric] = (counters[metric] ?? 0) + value;
  logInfo('BILLING_METRIC', { metric, value, total: counters[metric] });
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

export function getBillingMetrics(): Record<string, number> {
  return { ...counters };
}

/** Reset all counters (for tests only). */
export function resetBillingMetrics(): void {
  for (const key of Object.keys(counters)) {
    counters[key] = 0;
  }
}
