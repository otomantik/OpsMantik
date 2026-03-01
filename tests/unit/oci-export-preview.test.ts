/**
 * OCI export: markAsExported=false returns structured response and does not mutate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('google-ads-export route: markAsExported true returns flat array', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('if (markAsExported)'), 'branch on markAsExported');
  assert.ok(src.includes('return NextResponse.json(combined)'), 'flat array when true');
});

test('google-ads-export route: markAsExported false returns structured preview', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('siteId: siteUuid'), 'preview has siteId');
  assert.ok(src.includes('items: combined'), 'preview has items');
  assert.ok(src.includes('counts:'), 'preview has counts');
  assert.ok(src.includes('warnings:'), 'preview has warnings');
});

test('google-ads-export route: claim uses RPC not direct update', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('claim_offline_conversion_rows_for_script_export'), 'uses claim RPC');
});

test('claim RPC migration: increments attempt_count', () => {
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20260330000000_oci_claim_and_attempt_cap.sql');
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes('attempt_count + 1'), 'RPC increments attempt_count');
});
