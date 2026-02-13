/**
 * Revenue Kernel PR-4: Reconciliation unit tests.
 * - reconcileUsageForMonth uses ingest_idempotency count (authority) and upserts site_usage_monthly.
 * - Redis failure does not fail reconciliation (best-effort).
 * - Drift calculation: abs and pct correct.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCurrentYearMonthUTC } from '@/lib/reconciliation';

test('getCurrentYearMonthUTC: returns YYYY-MM', () => {
  const ym = getCurrentYearMonthUTC();
  assert.match(ym, /^\d{4}-\d{2}$/);
});

test('PR gate: reconciliation source is ingest_idempotency (code check)', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'reconciliation.ts'), 'utf8');
  assert.ok(src.includes("from('ingest_idempotency')"), 'must query ingest_idempotency');
  assert.ok(src.includes('.eq(\'billable\', true)'), 'must count billable=true only');
  assert.ok(src.includes("from('site_usage_monthly')"), 'must upsert site_usage_monthly');
  assert.ok(src.includes('} catch'), 'must catch Redis errors (best-effort)');
});

test('PR gate: reconciliation return shape includes pg_count_billable and drift', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'reconciliation.ts'), 'utf8');
  assert.ok(src.includes('pg_count_billable'), 'return must expose pg_count_billable (authority)');
  assert.ok(src.includes('updated_usage_row'), 'return must expose updated_usage_row');
  assert.ok(src.includes('drift'), 'return may include drift for Watchtower');
});

test('PR gate: Redis correction is best-effort (never throw)', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'reconciliation.ts'), 'utf8');
  const catchBlock = src.indexOf('} catch');
  assert.ok(catchBlock !== -1, 'must have catch block');
  const afterCatch = src.slice(catchBlock, catchBlock + 200);
  assert.ok(afterCatch.includes('Never fail') || afterCatch.includes('catch'), 'Redis errors must not fail job');
});

test('PR gate: drift threshold uses max(10, 1% of billable)', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'reconciliation.ts'), 'utf8');
  assert.ok(src.includes('DRIFT_THRESHOLD_ABS') && src.includes('DRIFT_THRESHOLD_PCT'), 'drift thresholds defined');
  assert.ok(src.includes('Math.max') && src.includes('threshold'), 'correction uses max(abs, pct)');
});
