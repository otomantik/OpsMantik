/**
 * PR4-C: call-event vs classifier paid-surface parity (telemetry only).
 */
import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { determineTrafficSource } from '@/lib/analytics/source-classifier';
import {
  buildClassifierParamsForCallEventParity,
  comparePaidSurfaceBuckets,
  paidSurfaceFromCallEventSourceType,
  paidSurfaceFromTrafficClassificationV1,
} from '@/lib/domain/deterministic-engine';
import { runCallEventPaidSurfaceParity } from '@/lib/domain/deterministic-engine/parity-call-event';
import { getRefactorMetricsMemory, resetRefactorMetricsMemoryForTests } from '@/lib/refactor/metrics';

test('paidSurfaceFromCallEventSourceType: identity', () => {
  assert.equal(paidSurfaceFromCallEventSourceType('paid'), 'paid');
  assert.equal(paidSurfaceFromCallEventSourceType('organic'), 'organic');
});

test('buildClassifierParamsForCallEventParity: merges gclid, wbraid, gbraid and UTM from intent_page_url', () => {
  const url = 'https://example.com/x?utm_medium=cpc&utm_source=google';
  const p = buildClassifierParamsForCallEventParity({
    sanitizedGclid: 'abcdefghijkl',
    sanitizedWbraid: 'wbraid123456',
    sanitizedGbraid: null,
    intentPageUrl: url,
  });
  assert.equal(p.gclid, 'abcdefghijkl');
  assert.equal(p.wbraid, 'wbraid123456');
  assert.equal(p.utm_medium, 'cpc');
  assert.equal(p.utm_source, 'google');
});

test('gclid alignment: merged sanitized gclid in params makes classifier paid when URL has no click id', () => {
  const urlNoIds = 'https://example.com/landing';
  const gclid = 'abcdefghijkl';
  const params = buildClassifierParamsForCallEventParity({
    sanitizedGclid: gclid,
    sanitizedWbraid: null,
    sanitizedGbraid: null,
    intentPageUrl: urlNoIds,
  });
  const tc = determineTrafficSource(urlNoIds, '', params);
  assert.equal(tc.traffic_medium, 'cpc');
  const shadow = paidSurfaceFromTrafficClassificationV1(tc);
  const primary = paidSurfaceFromCallEventSourceType('paid');
  assert.equal(comparePaidSurfaceBuckets(primary, shadow), 'match');
});

test('runCallEventPaidSurfaceParity: flag off — no call-event parity metrics', () => {
  const prev = process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
  try {
    delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    resetRefactorMetricsMemoryForTests();
    runCallEventPaidSurfaceParity({
      siteId: '00000000-0000-0000-0000-000000000001',
      intentPageUrl: 'https://example.com/',
      sanitizedGclid: null,
      sanitizedWbraid: null,
      sanitizedGbraid: null,
      sanitizedClickId: null,
    });
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_call_event_parity_check_total, 0);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    else process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = prev;
  }
});

test('runCallEventPaidSurfaceParity: flag on — organic/organic match', () => {
  const prev = process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
  try {
    process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = 'true';
    resetRefactorMetricsMemoryForTests();
    runCallEventPaidSurfaceParity({
      siteId: '00000000-0000-0000-0000-000000000001',
      intentPageUrl: null,
      sanitizedGclid: null,
      sanitizedWbraid: null,
      sanitizedGbraid: null,
      sanitizedClickId: null,
    });
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_call_event_parity_check_total, 1);
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_call_event_parity_match_total, 1);
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_call_event_parity_mismatch_total, 0);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    else process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = prev;
  }
});

test('runCallEventPaidSurfaceParity: flag on — mismatch when URL has paid UTM but no click ids (primary organic)', () => {
  const prev = process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
  try {
    process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = 'true';
    resetRefactorMetricsMemoryForTests();
    runCallEventPaidSurfaceParity({
      siteId: '00000000-0000-0000-0000-000000000001',
      intentPageUrl: 'https://example.com/page?utm_medium=cpc&utm_source=google',
      sanitizedGclid: null,
      sanitizedWbraid: null,
      sanitizedGbraid: null,
      sanitizedClickId: null,
    });
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_call_event_parity_check_total, 1);
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_call_event_parity_mismatch_total, 1);
    assert.equal(getRefactorMetricsMemory().truth_engine_consolidated_call_event_parity_match_total, 0);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED;
    else process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = prev;
  }
});
