import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATION_PATH = join(
  ROOT,
  'supabase',
  'migrations',
  '20260506174000_restore_entitlements_rpc_minimal.sql'
);

test('entitlements rpc contract migration exists', () => {
  assert.ok(
    existsSync(MIGRATION_PATH),
    'entitlements compatibility migration must exist'
  );
});

test('entitlements rpc migration defines canonical rpc and helper contracts', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._jwt_role\(\)/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._entitlements_no_access\(\)/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._entitlements_for_tier\(p_tier text\)/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_entitlements_for_site\(p_site_id uuid\)/i);
});

test('entitlements rpc migration keeps restricted execute grants', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_entitlements_for_site\(uuid\) FROM PUBLIC/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_entitlements_for_site\(uuid\) FROM anon/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_entitlements_for_site\(uuid\) TO authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_entitlements_for_site\(uuid\) TO service_role/i);
});
