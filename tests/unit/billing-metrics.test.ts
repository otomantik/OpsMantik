/**
 * PR-8: Billing observability — counters incremented on each path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getBillingMetrics,
  resetBillingMetrics,
  incrementBillingIngestAllowed,
  incrementBillingIngestDuplicate,
  incrementBillingIngestRejectedQuota,
  incrementBillingIngestRateLimited,
  incrementBillingIngestOverage,
  incrementBillingIngestDegraded,
  incrementBillingReconciliationRunOk,
  incrementBillingReconciliationRunFailed,
} from '@/lib/billing-metrics';

test('billing metrics: reset and get', () => {
  resetBillingMetrics();
  const m = getBillingMetrics();
  assert.equal(m.billing_ingest_allowed_total, 0);
  assert.equal(m.billing_ingest_duplicate_total, 0);
  assert.equal(m.billing_reconciliation_runs_ok_total, 0);
});

test('billing metrics: incrementBillingIngestAllowed increments counter', () => {
  resetBillingMetrics();
  incrementBillingIngestAllowed();
  incrementBillingIngestAllowed();
  assert.equal(getBillingMetrics().billing_ingest_allowed_total, 2);
});

test('billing metrics: incrementBillingIngestDuplicate increments counter', () => {
  resetBillingMetrics();
  incrementBillingIngestDuplicate();
  assert.equal(getBillingMetrics().billing_ingest_duplicate_total, 1);
});

test('billing metrics: incrementBillingIngestRejectedQuota increments counter', () => {
  resetBillingMetrics();
  incrementBillingIngestRejectedQuota();
  assert.equal(getBillingMetrics().billing_ingest_rejected_quota_total, 1);
});

test('billing metrics: incrementBillingIngestRateLimited increments counter', () => {
  resetBillingMetrics();
  incrementBillingIngestRateLimited();
  assert.equal(getBillingMetrics().billing_ingest_rate_limited_total, 1);
});

test('billing metrics: incrementBillingIngestOverage increments counter', () => {
  resetBillingMetrics();
  incrementBillingIngestOverage();
  assert.equal(getBillingMetrics().billing_ingest_overage_total, 1);
});

test('billing metrics: incrementBillingIngestDegraded increments counter', () => {
  resetBillingMetrics();
  incrementBillingIngestDegraded();
  assert.equal(getBillingMetrics().billing_ingest_degraded_total, 1);
});

test('billing metrics: reconciliation run ok/failed increment counters', () => {
  resetBillingMetrics();
  incrementBillingReconciliationRunOk();
  incrementBillingReconciliationRunOk();
  incrementBillingReconciliationRunFailed();
  assert.equal(getBillingMetrics().billing_reconciliation_runs_ok_total, 2);
  assert.equal(getBillingMetrics().billing_reconciliation_runs_failed_total, 1);
});

test('PR-8 gate: sync route increments billing_ingest_rate_limited on rate limit path', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'sync', 'route.ts'), 'utf8');
  const rateLimitBlock = src.slice(src.indexOf('if (!rl.allowed)'), src.indexOf('if (!rl.allowed)') + 400);
  assert.ok(rateLimitBlock.includes('incrementBillingIngestRateLimited'), 'rate limit path must increment billing_ingest_rate_limited');
});

test('PR-8 gate: sync route increments billing_ingest_duplicate on duplicate path', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'sync', 'route.ts'), 'utf8');
  assert.ok(src.includes('incrementBillingIngestDuplicate'), 'duplicate path must increment billing_ingest_duplicate');
});

test('PR-8 gate: sync route increments billing_ingest_rejected_quota on quota reject path', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'sync', 'route.ts'), 'utf8');
  assert.ok(src.includes('incrementBillingIngestRejectedQuota'), 'quota reject path must increment billing_ingest_rejected_quota');
});

test('PR-8 gate: sync route increments billing_ingest_allowed and overage on success path', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'sync', 'route.ts'), 'utf8');
  assert.ok(src.includes('incrementBillingIngestAllowed'), 'success path must increment billing_ingest_allowed');
  assert.ok(src.includes('incrementBillingIngestOverage'), 'overage path must increment billing_ingest_overage');
});

test('PR-8 gate: sync route increments billing_ingest_degraded on fallback path', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'sync', 'route.ts'), 'utf8');
  assert.ok(src.includes('incrementBillingIngestDegraded'), 'degraded/fallback path must increment billing_ingest_degraded');
});

test('PR-8 gate: reconciliation run route increments ok/failed', () => {
  const runSrc = readFileSync(join(process.cwd(), 'app', 'api', 'cron', 'reconcile-usage', 'run', 'route.ts'), 'utf8');
  assert.ok(runSrc.includes('incrementBillingReconciliationRunOk'), 'run route must increment reconciliation run ok');
  assert.ok(runSrc.includes('incrementBillingReconciliationRunFailed'), 'run route must increment reconciliation run failed');
  const unifiedSrc = readFileSync(join(process.cwd(), 'app', 'api', 'cron', 'reconcile-usage', 'route.ts'), 'utf8');
  assert.ok(unifiedSrc.includes('incrementBillingReconciliationRunOk'), 'unified route must increment reconciliation run ok');
  assert.ok(unifiedSrc.includes('incrementBillingReconciliationRunFailed'), 'unified route must increment reconciliation run failed');
});
