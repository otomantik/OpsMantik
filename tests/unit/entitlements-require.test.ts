/**
 * Sprint-1 Titanium Core: Unit tests for requireCapability and requireWithinLimit.
 * QA alignment: capability → 403, quota → 429 + x-opsmantik-quota-exceeded; limit < 0 = unlimited.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  requireCapability,
  requireWithinLimit,
  EntitlementError,
  QuotaExceededError,
} from '@/lib/entitlements/requireEntitlement';
import { FREE_FALLBACK } from '@/lib/entitlements/types';
import type { Entitlements } from '@/lib/entitlements/types';

function proEntitlements(): Entitlements {
  return {
    tier: 'PRO',
    capabilities: {
      dashboard_live_queue: true,
      dashboard_traffic_widget: true,
      csv_export: true,
      google_ads_sync: true,
      full_attribution_history: true,
      ai_cro_insights: true,
      superadmin_god_mode: false,
      agency_portfolio: false,
    },
    limits: {
      visible_queue_items: 1_000_000,
      history_days: 3650,
      monthly_revenue_events: 25_000,
      monthly_conversion_sends: 25_000,
    },
  };
}

test('requireCapability: granted capability does not throw', () => {
  const ent = proEntitlements();
  requireCapability(ent, 'google_ads_sync');
  requireCapability(ent, 'csv_export');
  requireCapability(ent, 'dashboard_live_queue');
});

test('requireCapability: missing capability throws EntitlementError with correct code and capability', () => {
  assert.throws(
    () => requireCapability(FREE_FALLBACK, 'google_ads_sync'),
    EntitlementError,
    'FREE_FALLBACK must throw for google_ads_sync (fail-closed)'
  );
  try {
    requireCapability(FREE_FALLBACK, 'google_ads_sync');
  } catch (err) {
    assert.equal((err as EntitlementError).capability, 'google_ads_sync');
    assert.equal((err as EntitlementError).code, 'CAPABILITY_REQUIRED');
  }
});

test('requireCapability: FREE tier without google_ads_sync throws', () => {
  const free = { ...FREE_FALLBACK };
  assert.throws(() => requireCapability(free, 'google_ads_sync'), EntitlementError);
});

test('requireWithinLimit: usage below limit does not throw', () => {
  requireWithinLimit(100, 0);
  requireWithinLimit(100, 99);
  requireWithinLimit(25_000, 24_999);
});

test('requireWithinLimit: usage at or above limit throws QuotaExceededError', () => {
  assert.throws(() => requireWithinLimit(100, 100), QuotaExceededError);
  assert.throws(() => requireWithinLimit(100, 101), QuotaExceededError);
  assert.throws(() => requireWithinLimit(25_000, 25_000), QuotaExceededError);
});

test('requireWithinLimit: negative limit is unlimited (no throw)', () => {
  requireWithinLimit(-1, 0);
  requireWithinLimit(-1, 1_000_000);
  requireWithinLimit(-1, 999_999_999);
});

test('requireWithinLimit: QuotaExceededError has code QUOTA_EXCEEDED', () => {
  try {
    requireWithinLimit(10, 10);
  } catch (err) {
    assert.equal((err as QuotaExceededError).code, 'QUOTA_EXCEEDED');
    assert.ok(err instanceof QuotaExceededError);
  }
});

test('PR gate: quota 429 must use x-opsmantik-quota-exceeded only (rate-limit separate)', () => {
  const syncPath = join(process.cwd(), 'app', 'api', 'sync', 'route.ts');
  const src = readFileSync(syncPath, 'utf8');
  const entitlementsLimitBlock = src.indexOf('rejected_entitlements_quota');
  assert.ok(entitlementsLimitBlock !== -1, 'sync must have entitlements quota reject path');
  const block = src.slice(entitlementsLimitBlock, entitlementsLimitBlock + 400);
  assert.ok(block.includes("'x-opsmantik-quota-exceeded'"), 'entitlements quota 429 must set x-opsmantik-quota-exceeded');
  assert.ok(!block.includes('x-opsmantik-ratelimit'), 'entitlements quota 429 must NOT set rate-limit header');
});
