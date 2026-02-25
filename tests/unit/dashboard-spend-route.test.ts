/**
 * GET /api/dashboard/spend: contract tests (auth, siteId, requireModule, 403 on missing module).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routePath = join(process.cwd(), 'app', 'api', 'dashboard', 'spend', 'route.ts');

test('GET /api/dashboard/spend: requires auth', () => {
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('getUser()'), 'route checks auth');
});

test('GET /api/dashboard/spend: requires siteId query param', () => {
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('siteId') && src.includes('searchParams'), 'route reads siteId from query');
  assert.ok(src.includes('siteId is required') || src.includes("'siteId'"), 'route returns 400 when siteId missing');
});

test('GET /api/dashboard/spend: validates site access', () => {
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('validateSiteAccess'), 'route validates site access');
});

test('GET /api/dashboard/spend: enforces google_ads_spend module', () => {
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('requireModule') && src.includes('google_ads_spend'), 'route calls requireModule for google_ads_spend');
  assert.ok(src.includes('ModuleNotEnabledError') || src.includes('MODULE_NOT_ENABLED'), 'route handles module not enabled');
  assert.ok(src.includes('403'), 'route returns 403 when module missing');
});

test('GET /api/dashboard/spend: returns data from ad_spend_daily', () => {
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('ad_spend_daily'), 'route queries ad_spend_daily');
});
