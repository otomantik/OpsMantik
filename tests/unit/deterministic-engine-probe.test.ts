/**
 * PR4-A: shadow probe wiring — metrics only when TRUTH_ENGINE_CONSOLIDATED_ENABLED; no return-shape change.
 */
import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { AttributionService } from '@/lib/services/attribution-service';
import { runDeterministicEngineProbe } from '@/lib/domain/deterministic-engine/probe';
import { getRefactorMetricsMemory, resetRefactorMetricsMemoryForTests } from '@/lib/refactor/metrics';

const SITE_ID = '00000000-0000-0000-0000-000000000001';
const URL = 'https://example.com/';
const REFERRER = 'https://www.google.com/';

function makeNoopEventsMock(): import('@supabase/supabase-js').SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            not: () => ({
              in: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

test('runDeterministicEngineProbe: flag off does not increment probe metric', () => {
  const prev = process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
  try {
    delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    resetRefactorMetricsMemoryForTests();
    runDeterministicEngineProbe({ kind: 'attribution_resolve', siteId: SITE_ID });
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_probe_total, 0);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    else process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = prev;
  }
});

test('runDeterministicEngineProbe: flag on increments probe metric once', () => {
  const prev = process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
  try {
    process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = 'true';
    resetRefactorMetricsMemoryForTests();
    runDeterministicEngineProbe({ kind: 'attribution_resolve', siteId: SITE_ID });
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_probe_total, 1);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    else process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = prev;
  }
});

test('AttributionService.resolveAttribution: flag off — no probe metric; return shape unchanged', async () => {
  const prev = process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
  try {
    delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    resetRefactorMetricsMemoryForTests();
    const result = await AttributionService.resolveAttribution(
      SITE_ID,
      'validgclid12charsormore',
      null,
      URL,
      REFERRER,
      { client: makeNoopEventsMock() }
    );
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_probe_total, 0);
    assert.ok('attribution' in result && 'utm' in result && 'hasPastGclid' in result);
    assert.equal(result.attribution.source, 'First Click (Paid)');
    assert.equal(typeof result.hasPastGclid, 'boolean');
  } finally {
    if (prev === undefined) delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    else process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = prev;
  }
});

test('AttributionService.resolveAttribution: flag on — one probe increment per call; same attribution shape', async () => {
  const prev = process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
  try {
    process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = 'true';
    resetRefactorMetricsMemoryForTests();
    const result = await AttributionService.resolveAttribution(
      SITE_ID,
      'validgclid12charsormore',
      null,
      URL,
      REFERRER,
      { client: makeNoopEventsMock() }
    );
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_probe_total, 1);
    assert.equal(result.attribution.source, 'First Click (Paid)');
    assert.equal(result.hasPastGclid, false);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    else process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = prev;
  }
});
