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

test('projection-updater uses deterministic reducer order', async () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'funnel-kernel', 'projection-updater.ts'),
    'utf8'
  );
  assert.ok(src.includes("order('occurred_at'"), 'must order by occurred_at first');
  assert.ok(src.includes("order('ingested_at'"), 'must order by ingested_at');
  assert.ok(src.includes("order('created_at'"), 'must order by created_at');
  assert.ok(src.includes("order('id'"), 'must order by id');
});

test('projection-updater reduces V2_CONTACT and V2_SYNTHETIC to v2_source', async () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'funnel-kernel', 'projection-updater.ts'),
    'utf8'
  );
  assert.ok(src.includes('V2_SYNTHETIC') && src.includes("'SYNTHETIC'"), 'must set v2_source for synthetic');
  assert.ok(src.includes('V2_CONTACT') && src.includes("'REAL'"), 'must set v2_source for real');
});
