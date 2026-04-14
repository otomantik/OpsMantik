/**
 * PR4-B: pure helpers + gclid merge alignment (no false mismatch when URL omits gclid).
 */
import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { determineTrafficSource } from '@/lib/analytics/source-classifier';
import { computeAttribution } from '@/lib/attribution';
import {
  buildClassifierParamsForParity,
  comparePaidSurfaceBuckets,
  paidSurfaceFromAttributionResult,
  paidSurfaceFromTrafficClassificationV1,
} from '@/lib/domain/deterministic-engine';
import { runAttributionPaidSurfaceParity } from '@/lib/domain/deterministic-engine/parity-attribution';
import { getRefactorMetricsMemory, resetRefactorMetricsMemoryForTests } from '@/lib/refactor/metrics';

test('paidSurfaceFromAttributionResult: isPaid maps to bucket', () => {
  assert.equal(paidSurfaceFromAttributionResult({ source: 'Organic', isPaid: false }), 'organic');
  assert.equal(paidSurfaceFromAttributionResult({ source: 'First Click (Paid)', isPaid: true }), 'paid');
});

test('paidSurfaceFromTrafficClassificationV1: cpc and social (PR4-B v1) -> paid', () => {
  assert.equal(
    paidSurfaceFromTrafficClassificationV1({ traffic_source: 'Google Ads', traffic_medium: 'cpc' }),
    'paid'
  );
  assert.equal(
    paidSurfaceFromTrafficClassificationV1({ traffic_source: 'Facebook', traffic_medium: 'social' }),
    'paid'
  );
  assert.equal(
    paidSurfaceFromTrafficClassificationV1({ traffic_source: 'SEO', traffic_medium: 'organic' }),
    'organic'
  );
  assert.equal(
    paidSurfaceFromTrafficClassificationV1({ traffic_source: 'Direct', traffic_medium: 'direct' }),
    'organic'
  );
});

test('comparePaidSurfaceBuckets', () => {
  assert.equal(comparePaidSurfaceBuckets('paid', 'paid'), 'match');
  assert.equal(comparePaidSurfaceBuckets('organic', 'paid'), 'mismatch');
});

test('buildClassifierParamsForParity: merges utm and sanitized gclid', () => {
  const p = buildClassifierParamsForParity({
    sanitizedGclid: 'abcdefghijkl',
    utm: { medium: 'cpc', source: 'google' },
  });
  assert.equal(p.gclid, 'abcdefghijkl');
  assert.equal(p.utm_medium, 'cpc');
  assert.equal(p.utm_source, 'google');
});

test('gclid alignment: merged sanitized gclid prevents false mismatch when URL has no gclid', () => {
  const urlNoGclid = 'https://example.com/landing/path';
  const validGclid = 'abcdefghijkl';

  const attribution = computeAttribution({
    gclid: validGclid,
    utm: null,
    referrer: null,
    hasPastGclid: false,
  });
  assert.equal(attribution.isPaid, true);
  const primary = paidSurfaceFromAttributionResult(attribution);
  assert.equal(primary, 'paid');

  const tcUrlOnly = determineTrafficSource(urlNoGclid, '', {});
  const shadowUrlOnly = paidSurfaceFromTrafficClassificationV1(tcUrlOnly);
  assert.equal(
    comparePaidSurfaceBuckets(primary, shadowUrlOnly),
    'mismatch',
    'URL alone should not classify as paid without click id in query'
  );

  const merged = buildClassifierParamsForParity({ sanitizedGclid: validGclid, utm: null });
  const tcMerged = determineTrafficSource(urlNoGclid, '', merged);
  assert.equal(tcMerged.traffic_medium, 'cpc');
  const shadowMerged = paidSurfaceFromTrafficClassificationV1(tcMerged);
  assert.equal(shadowMerged, 'paid');
  assert.equal(comparePaidSurfaceBuckets(primary, shadowMerged), 'match');
});

test('runAttributionPaidSurfaceParity: flag off — no parity metrics', () => {
  const prev = process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
  try {
    delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    resetRefactorMetricsMemoryForTests();
    runAttributionPaidSurfaceParity({
      siteId: '00000000-0000-0000-0000-000000000001',
      url: 'https://example.com/',
      referrer: null,
      sanitizedGclid: null,
      utm: null,
      attribution: { source: 'Organic', isPaid: false },
    });
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_attribution_parity_check_total, 0);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    else process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = prev;
  }
});

test('runAttributionPaidSurfaceParity: flag on — check + match for aligned organic', () => {
  const prev = process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
  try {
    process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = 'true';
    resetRefactorMetricsMemoryForTests();
    runAttributionPaidSurfaceParity({
      siteId: '00000000-0000-0000-0000-000000000001',
      url: 'https://example.com/',
      referrer: null,
      sanitizedGclid: null,
      utm: null,
      attribution: { source: 'Organic', isPaid: false },
    });
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_attribution_parity_check_total, 1);
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_attribution_parity_match_total, 1);
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_attribution_parity_mismatch_total, 0);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    else process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = prev;
  }
});
