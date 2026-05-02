/**
 * Idempotency + guard tests for `upsertMarketingSignal` (Phase 5).
 *
 * The helper is the SSOT for writing to `marketing_signals`. Before any DB
 * round-trip, it applies two invariants that must never drift:
 *   1) Missing all click IDs  ⇒ return { success: true, skipped: true,
 *                                         skippedReason: 'missing_click_ids' }
 *      The helper is short-circuit-safe: callers still succeed, but no row is
 *      written. This stops the export pipeline from ever emitting a row
 *      without provenance.
 *   2) The `won` stage is type-level gated (`Exclude<PipelineStage, 'won'>`).
 *      Won rows are owned by offline_conversion_queue, not marketing_signals.
 *
 * DB-level idempotency (23505 → duplicate: true) is covered by the file-level
 * architecture test; it requires a live Supabase admin client to exercise.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { upsertMarketingSignal } from '@/lib/domain/mizan-mantik/upsert-marketing-signal';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';
import { resolveMarketingSignalEconomics } from '@/lib/oci/marketing-signal-value-ssot';

const CONTACTED_SNAPSHOT = buildOptimizationSnapshot({
  stage: 'contacted',
  systemScore: 60,
  actualRevenue: null,
});

const CONTACTED_ECONOMICS = resolveMarketingSignalEconomics({
  stage: 'contacted',
  snapshot: CONTACTED_SNAPSHOT,
  siteCurrency: 'TRY',
});

const BASE_PARAMS = {
  source: 'router' as const,
  siteId: 'site-1',
  callId: 'call-1',
  traceId: 'trace-1',
  stage: 'contacted' as const,
  signalDate: new Date('2026-04-19T10:00:00.000Z'),
  snapshot: CONTACTED_SNAPSHOT,
  economics: CONTACTED_ECONOMICS,
  causalDna: { origin: 'unit-test' } as Record<string, unknown>,
};

function noClickIds() {
  return { gclid: null, wbraid: null, gbraid: null };
}

test('upsertMarketingSignal skips when every click id is null (no DB touched)', async () => {
  const result = await upsertMarketingSignal({
    ...BASE_PARAMS,
    clickIds: noClickIds(),
  });
  assert.equal(result.success, true);
  assert.equal(result.skipped, true);
  assert.equal(result.skippedReason, 'missing_click_ids');
  assert.equal(result.expectedValueCents, 0);
  assert.equal(result.currentHash, '');
  assert.equal(result.adjustmentSequence, 0);
});

test('upsertMarketingSignal skips when click ids are blank strings', async () => {
  const result = await upsertMarketingSignal({
    ...BASE_PARAMS,
    clickIds: { gclid: '', wbraid: '', gbraid: '' },
  });
  assert.equal(result.success, true);
  assert.equal(result.skipped, true);
  assert.equal(result.skippedReason, 'missing_click_ids');
});

test('upsertMarketingSignal source type accepts router / seal / panel_stage only', () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'mizan-mantik', 'upsert-marketing-signal.ts'),
    'utf8'
  );
  assert.ok(
    /export type UpsertMarketingSignalSource[\s\S]*'router'[\s\S]*'seal'[\s\S]*'panel_stage'/.test(
      src
    ),
    'source enum drifted — update this test if a new provenance is intentional'
  );
});

test('upsertMarketingSignal stage type gates out won at compile time (seal owns Won)', () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'mizan-mantik', 'upsert-marketing-signal.ts'),
    'utf8'
  );
  assert.match(
    src,
    /stage:\s*Exclude<PipelineStage,\s*'won'>/,
    'stage type-gate drifted — won must be seal/offline queue only; junk/contacted/offered use this helper'
  );
});

test('upsertMarketingSignal exposes a duplicate: true collapse for 23505', () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'mizan-mantik', 'upsert-marketing-signal.ts'),
    'utf8'
  );
  assert.match(src, /code === '23505'/, 'duplicate key guard missing');
  assert.match(src, /duplicate:\s*true/, 'duplicate: true collapse missing');
  assert.match(
    src,
    /marketing_signals_duplicate_ignored/,
    'duplicate log event drifted — ops queries rely on this name'
  );
});
