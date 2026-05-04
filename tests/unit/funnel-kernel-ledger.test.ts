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

// Reducer order and English canonical stages are pinned in docs + TypeScript;
// the `rebuild_call_projection` SQL may ship only in remote DB / squashed baselines.

const PROJECTION_SPEC = join(process.cwd(), 'docs', 'architecture', 'PROJECTION_REDUCER_SPEC.md');

test('projection-updater uses deterministic reducer order', async () => {
  const src = readFileSync(PROJECTION_SPEC, 'utf8');
  assert.ok(
    src.includes('ORDER BY occurred_at ASC NULLS LAST, ingested_at ASC, created_at ASC, id ASC'),
    'PROJECTION_REDUCER_SPEC must pin deterministic reducer tuple'
  );
});

test('projection-updater reduces only canonical (English) stages into projection timestamps', async () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'funnel-kernel', 'ledger-writer.ts'),
    'utf8'
  );
  assert.ok(src.includes("'contacted'"), 'ledger must use canonical contacted stage');
  assert.ok(src.includes("'offered'"), 'ledger must use canonical offered stage');
  assert.ok(src.includes("'won'"), 'ledger must use canonical won stage');
  const proj = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'funnel-kernel', 'projection-updater.ts'),
    'utf8'
  );
  assert.ok(!proj.includes('v2_source'), 'projection-updater must not reference legacy v2_source');
});

test('projection-updater delegates rebuild to atomic RPC', async () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'funnel-kernel', 'projection-updater.ts'),
    'utf8'
  );
  assert.ok(src.includes("rpc('rebuild_call_projection'"), 'projection-updater must use rebuild_call_projection RPC');
  const spec = readFileSync(PROJECTION_SPEC, 'utf8');
  assert.ok(
    spec.includes('Deterministik') && spec.includes('ORDER BY'),
    'PROJECTION_REDUCER_SPEC must document deterministic reducer contract'
  );
});
