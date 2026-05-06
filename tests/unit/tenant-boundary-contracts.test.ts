import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATION_PATH = join(
  ROOT,
  'supabase',
  'migrations',
  '20260506181500_restore_tenant_boundary_contracts_minimal.sql'
);

test('tenant-boundary contract migration exists', () => {
  assert.ok(
    existsSync(MIGRATION_PATH),
    'tenant-boundary compatibility migration must exist'
  );
});

test('tenant-boundary contract migration pins required tables and rpc', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  assert.match(sql, /ALTER TABLE public\.calls[\s\S]*session_created_month/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.conversations/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.conversation_links/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.sales/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_conversation_with_primary_entity/i);
});

test('tenant-boundary migration preserves deterministic rejection semantics', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  assert.match(sql, /primary_entity_site_mismatch/i);
  assert.match(sql, /entity must belong to the same site as the conversation/i);
  assert.match(sql, /conversation_id must belong to the same site as the sale/i);
});
