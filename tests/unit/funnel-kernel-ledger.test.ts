/**
 * Funnel Kernel Ledger Writer and Projection Updater contract tests
 * Verifies exported API and reducer order contract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('ledger-writer exports appendFunnelEvent', async () => {
  const mod = await import('@/lib/domain/funnel-kernel/ledger-writer');
  assert.ok(typeof mod.appendFunnelEvent === 'function');
});

test('ledger-writer validates tenant: call must belong to site', async () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'funnel-kernel', 'ledger-writer.ts'),
    'utf8'
  );
  assert.ok(src.includes("select('site_id')"), 'must select site_id from calls');
  assert.ok(src.includes('callRow.site_id') && src.includes('siteId'), 'must validate tenant');
  assert.ok(src.includes('tenant mismatch'), 'must throw on mismatch');
});

test('ledger-writer handles 23505 as idempotent skip', async () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'funnel-kernel', 'ledger-writer.ts'),
    'utf8'
  );
  assert.ok(src.includes('23505'), 'must detect unique violation');
  assert.ok(src.includes('appended: false'), 'must return appended: false');
});

// The canonical reducer RPC lives in the English-only cutover migration
// (20260419150000). It supersedes the original 20260324000001 RPC, which used
// Turkish column names. The tests below read from the cutover migration.
const CUTOVER_RPC_MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260419150000_english_only_cutover.sql'
);

test('projection-updater uses deterministic reducer order', async () => {
  const src = readFileSync(CUTOVER_RPC_MIGRATION, 'utf8');
  assert.ok(
    src.includes('ORDER BY occurred_at ASC, ingested_at ASC, created_at ASC, id ASC'),
    'must order by deterministic reducer tuple'
  );
});

test('projection-updater reduces only canonical (English) stages into projection timestamps', async () => {
  const src = readFileSync(CUTOVER_RPC_MIGRATION, 'utf8');
  assert.ok(src.includes("v_row.event_type = 'contacted'"), 'must reduce contacted directly');
  assert.ok(src.includes("v_row.event_type = 'offered'"), 'must reduce offered directly');
  assert.ok(src.includes("v_row.event_type = 'won'"), 'must reduce won directly');
  assert.ok(!src.includes('v2_source'), 'legacy v2_source projection column must stay removed');
});

test('projection-updater delegates rebuild to atomic RPC', async () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'funnel-kernel', 'projection-updater.ts'),
    'utf8'
  );
  assert.ok(src.includes("rpc('rebuild_call_projection'"), 'projection-updater must use rebuild_call_projection RPC');
  const migration = readFileSync(CUTOVER_RPC_MIGRATION, 'utf8');
  assert.ok(
    migration.includes('CREATE OR REPLACE FUNCTION public.rebuild_call_projection'),
    'rebuild RPC migration must exist (English-only canonical)'
  );
});
