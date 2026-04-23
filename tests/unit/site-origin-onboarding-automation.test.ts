import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const createRoutePath = join(process.cwd(), 'app', 'api', 'sites', 'create', 'route.ts');
const migrationPath = join(process.cwd(), 'supabase', 'migrations', '00000000000002_global_onboarding.sql');

test('site create route auto-seeds site_allowed_origins', () => {
  const source = readFileSync(createRoutePath, 'utf8');
  assert.ok(source.includes('seedSiteAllowedOrigins'), 'route includes origin seed helper');
  assert.ok(source.includes('site_allowed_origins'), 'route writes into site_allowed_origins');
});

test('global onboarding migration creates origin registry table', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS public.site_allowed_origins'));
  assert.ok(sql.includes('verification_state'));
  assert.ok(sql.includes('site_allowed_origins_service_role_write'));
});
