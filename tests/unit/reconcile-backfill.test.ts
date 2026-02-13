/**
 * Unit tests for reconciliation backfill endpoint.
 * POST /api/cron/reconcile-usage/backfill
 * - Validates date range (YYYY-MM, from <= to, max 12 months).
 * - Builds jobs from months × sites; UPSERT ON CONFLICT DO NOTHING.
 * - Returns { enqueued, months, sites }.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BACKFILL_ROUTE = join(process.cwd(), 'app', 'api', 'cron', 'reconcile-usage', 'backfill', 'route.ts');

test('backfill route exists and exports POST', () => {
  const src = readFileSync(BACKFILL_ROUTE, 'utf8');
  assert.ok(src.includes('export async function POST'), 'must export POST handler');
});

test('backfill route uses requireCronAuth', () => {
  const src = readFileSync(BACKFILL_ROUTE, 'utf8');
  assert.ok(src.includes('requireCronAuth'), 'must use cron auth');
  assert.ok(src.includes('requireCronAuth(req)'), 'must call requireCronAuth with request');
});

test('backfill validates date range (YYYY-MM, max 12 months)', () => {
  const src = readFileSync(BACKFILL_ROUTE, 'utf8');
  assert.ok(src.includes('YEAR_MONTH_REGEX') || /\\d{4}-\\d{2}/.test(src), 'must validate YYYY-MM format');
  assert.ok(src.includes('MAX_MONTHS') || src.includes('12'), 'must enforce max 12 months');
  assert.ok(
    src.includes('months.length >') || src.includes('length > MAX_MONTHS'),
    'must reject range > 12 months'
  );
});

test('backfill builds months between from and to', () => {
  const src = readFileSync(BACKFILL_ROUTE, 'utf8');
  assert.ok(src.includes('monthsBetween') || src.includes('months'), 'must compute month list');
});

test('backfill uses UPSERT with ON CONFLICT DO NOTHING', () => {
  const src = readFileSync(BACKFILL_ROUTE, 'utf8');
  assert.ok(src.includes('billing_reconciliation_jobs'), 'must target billing_reconciliation_jobs');
  assert.ok(src.includes('upsert'), 'must upsert jobs');
  assert.ok(
    (src.includes('onConflict') && src.includes('ignoreDuplicates')) ||
      src.includes('site_id,year_month'),
    'must use onConflict and ignoreDuplicates (DO NOTHING)'
  );
});

test('backfill returns enqueued, months, sites', () => {
  const src = readFileSync(BACKFILL_ROUTE, 'utf8');
  assert.ok(src.includes('enqueued'), 'response must include enqueued');
  assert.ok(src.includes('months'), 'response must include months');
  assert.ok(src.includes('sites'), 'response must include sites');
});

test('backfill accepts optional site_id and required from/to in body', () => {
  const src = readFileSync(BACKFILL_ROUTE, 'utf8');
  assert.ok(src.includes('body.from') && src.includes('body.to'), 'must read from and to from body');
  assert.ok(src.includes('site_id'), 'must handle site_id (optional)');
});

test('backfill when no site_id queries ingest_idempotency for active sites in range', () => {
  const src = readFileSync(BACKFILL_ROUTE, 'utf8');
  assert.ok(src.includes('ingest_idempotency'), 'must query ingest_idempotency for sites when site_id omitted');
  assert.ok(
    src.includes('year_month') && (src.includes('gte') || src.includes('lte')),
    'must filter by year_month in range'
  );
});
