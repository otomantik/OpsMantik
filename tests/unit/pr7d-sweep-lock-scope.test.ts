import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ROUTE_PATH = join(ROOT, 'app', 'api', 'cron', 'sweep-unsent-conversions', 'route.ts');

test('PR-7D sweep route derives site-scoped lock key when site_id exists', () => {
  const route = readFileSync(ROUTE_PATH, 'utf8');
  assert.ok(route.includes('function deriveSweepLockPath(siteId?: string | null): string'));
  assert.ok(route.includes('return siteId ? `${SWEEP_LOCK_GLOBAL_PATH}:site:${siteId}` : SWEEP_LOCK_GLOBAL_PATH'));
  assert.ok(route.includes('const lockPath = deriveSweepLockPath(targetSiteId)'));
});

test('PR-7D sweep route keeps global lock when site_id is absent', () => {
  const route = readFileSync(ROUTE_PATH, 'utf8');
  assert.ok(route.includes("const SWEEP_LOCK_GLOBAL_PATH = 'sweep-unsent-conversions'"));
});

test('PR-7D sweep route fail-closes on invalid/missing site_id for repair intent', () => {
  const route = readFileSync(ROUTE_PATH, 'utf8');
  assert.ok(route.includes("error: 'invalid_site_id'"));
  assert.ok(route.includes("error: 'site_id_required_for_repair'"));
  assert.ok(route.includes('hasRepairIntent(req) && !targetSiteId'));
});
