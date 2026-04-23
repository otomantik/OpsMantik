import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workerPath = join(process.cwd(), 'adsmantik-engine', 'src', 'index.ts');
const tenantMapRoutePath = join(process.cwd(), 'app', 'api', 'internal', 'worker', 'tenant-map', 'route.ts');

test('worker supports runtime tenant map URL with cache', () => {
  const source = readFileSync(workerPath, 'utf8');
  assert.ok(source.includes('SITE_CONFIG_URL'), 'worker env includes SITE_CONFIG_URL');
  assert.ok(source.includes('loadTenantMap'), 'worker has tenant map loader');
  assert.ok(source.includes('tenantMapCache'), 'worker has in-memory tenant map cache');
});

test('tenant map API endpoint exists and is token protected', () => {
  const source = readFileSync(tenantMapRoutePath, 'utf8');
  assert.ok(source.includes('WORKER_TENANT_MAP_TOKEN'), 'endpoint checks worker token');
  assert.ok(source.includes('.from(\'sites\')'), 'endpoint loads domains from sites table');
  assert.ok(source.includes('map[`www.${host}`]'), 'endpoint emits www host aliases');
});
