/**
 * Unit tests for PR-3 Quota Engine.
 * - Hard limit (soft_limit_enabled=false): reject when usage >= monthly_limit.
 * - Soft limit: allow overage until hard_cap; then reject.
 * - Headers: quota-remaining clamp (never negative), overage header.
 * - Retry-After: non-negative, <= ~32 days in seconds.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCurrentYearMonthUTC,
  getSitePlan,
  evaluateQuota,
  computeRetryAfterToMonthRollover,
  clearPlanCache,
  _setPlanFetcherForTest,
  type SitePlan,
} from '@/lib/quota';

test('getCurrentYearMonthUTC: returns YYYY-MM format', () => {
  const ym = getCurrentYearMonthUTC();
  assert.match(ym, /^\d{4}-\d{2}$/, 'must be YYYY-MM');
  const [y, m] = ym.split('-').map(Number);
  assert.ok(y >= 2020 && y <= 2030, 'year in range');
  assert.ok(m >= 1 && m <= 12, 'month 1-12');
});

test('evaluateQuota: usage < limit => allow, no overage', () => {
  const plan: SitePlan = { site_id: 'x', monthly_limit: 100, soft_limit_enabled: false, hard_cap_multiplier: 2 };
  const d = evaluateQuota(plan, 50);
  assert.equal(d.allow, true);
  assert.equal(d.overage, false);
  assert.equal(d.reject, false);
  assert.equal(d.headers['x-opsmantik-quota-remaining'], '50');
  assert.equal(d.headers['x-opsmantik-overage'], undefined);
});

test('evaluateQuota: hard limit (soft_limit=false) rejects when usage >= monthly_limit', () => {
  const plan: SitePlan = { site_id: 'x', monthly_limit: 100, soft_limit_enabled: false, hard_cap_multiplier: 2 };
  const d = evaluateQuota(plan, 100);
  assert.equal(d.allow, false);
  assert.equal(d.reject, true);
  assert.equal(d.reason, 'monthly_limit_exceeded');
  assert.equal(d.headers['x-opsmantik-quota-exceeded'], '1');
  assert.equal(d.headers['x-opsmantik-quota-remaining'], '0');
});

test('evaluateQuota: soft limit allows overage until hard cap', () => {
  const plan: SitePlan = { site_id: 'x', monthly_limit: 100, soft_limit_enabled: true, hard_cap_multiplier: 2 };
  const d = evaluateQuota(plan, 150);
  assert.equal(d.allow, true);
  assert.equal(d.overage, true);
  assert.equal(d.reject, false);
  assert.equal(d.headers['x-opsmantik-overage'], 'true');
  assert.equal(d.headers['x-opsmantik-quota-remaining'], '0');
});

test('evaluateQuota: hard cap rejects even with soft_limit=true', () => {
  const plan: SitePlan = { site_id: 'x', monthly_limit: 100, soft_limit_enabled: true, hard_cap_multiplier: 2 };
  const hardCap = 200;
  const d = evaluateQuota(plan, hardCap);
  assert.equal(d.allow, false);
  assert.equal(d.reject, true);
  assert.equal(d.hardCapHit, true);
  assert.equal(d.headers['x-opsmantik-quota-exceeded'], '1');
});

test('evaluateQuota: quota-remaining never negative (clamp at 0)', () => {
  const plan: SitePlan = { site_id: 'x', monthly_limit: 10, soft_limit_enabled: false, hard_cap_multiplier: 2 };
  const d = evaluateQuota(plan, 99);
  assert.equal(d.headers['x-opsmantik-quota-remaining'], '0');
});

test('computeRetryAfterToMonthRollover: non-negative and <= ~32 days in seconds', () => {
  const sec = computeRetryAfterToMonthRollover();
  assert.ok(sec >= 0, 'Retry-After must be non-negative');
  const maxSec = 32 * 24 * 3600;
  assert.ok(sec <= maxSec, 'Retry-After capped at ~32 days');
});

test('getSitePlan: cache is strictly per site_id — site A and site B get different plans, no cross-tenant reuse', async () => {
  const siteA = 'a0000000-0000-0000-0000-000000000001';
  const siteB = 'b0000000-0000-0000-0000-000000000002';

  clearPlanCache();
  _setPlanFetcherForTest(async (siteIdUuid: string) => {
    if (siteIdUuid === siteA) return { monthly_limit: 100, soft_limit_enabled: false, hard_cap_multiplier: 2 };
    if (siteIdUuid === siteB) return { monthly_limit: 200, soft_limit_enabled: true, hard_cap_multiplier: 3 };
    return null;
  });

  try {
    const planA1 = await getSitePlan(siteA);
    const planB = await getSitePlan(siteB);
    const planA2 = await getSitePlan(siteA);

    assert.equal(planA1.site_id, siteA, 'plan A must be keyed by site A');
    assert.equal(planB.site_id, siteB, 'plan B must be keyed by site B');
    assert.equal(planA2.site_id, siteA, 'second call for A must still return site A');

    assert.equal(planA1.monthly_limit, 100, 'site A must have monthly_limit 100');
    assert.equal(planB.monthly_limit, 200, 'site B must have monthly_limit 200 (different from A)');
    assert.equal(planA2.monthly_limit, 100, 'cached A must still be 100, not B’s 200');

    assert.equal(planB.soft_limit_enabled, true, 'site B has soft_limit_enabled true');
    assert.equal(planA1.soft_limit_enabled, false, 'site A has soft_limit_enabled false');
    assert.equal(planA1.monthly_limit, planA2.monthly_limit, 'second call for A returns cached value');
  } finally {
    _setPlanFetcherForTest(null);
    clearPlanCache();
  }
});
