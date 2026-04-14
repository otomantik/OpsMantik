import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyConsentProvenanceShadowMetrics,
  evaluateConsentProvenanceShadow,
} from '@/lib/compliance/consent-provenance-shadow';
import { getRefactorMetricsMemory, resetRefactorMetricsMemoryForTests } from '@/lib/refactor/metrics';

test('evaluateConsentProvenanceShadow: missing_session when session null', () => {
  assert.equal(
    evaluateConsentProvenanceShadow({ payloadClaimsAnalytics: true, session: null }),
    'missing_session'
  );
});

test('evaluateConsentProvenanceShadow: mismatch when payload analytics but session lacks scope', () => {
  assert.equal(
    evaluateConsentProvenanceShadow({
      payloadClaimsAnalytics: true,
      session: {
        consent_scopes: ['marketing'],
        consent_at: '2026-01-01T00:00:00.000Z',
        consent_provenance: { source: 'cmp' },
      },
    }),
    'mismatch'
  );
});

test('evaluateConsentProvenanceShadow: mismatch when consent_at null', () => {
  assert.equal(
    evaluateConsentProvenanceShadow({
      payloadClaimsAnalytics: true,
      session: {
        consent_scopes: ['analytics'],
        consent_at: null,
        consent_provenance: { source: 'cmp' },
      },
    }),
    'mismatch'
  );
});

test('evaluateConsentProvenanceShadow: low_trust when source unknown', () => {
  assert.equal(
    evaluateConsentProvenanceShadow({
      payloadClaimsAnalytics: true,
      session: {
        consent_scopes: ['analytics'],
        consent_at: '2026-01-01T00:00:00.000Z',
        consent_provenance: { source: 'unknown' },
      },
    }),
    'low_trust'
  );
});

test('evaluateConsentProvenanceShadow: info when payload omits analytics, session has analytics', () => {
  assert.equal(
    evaluateConsentProvenanceShadow({
      payloadClaimsAnalytics: false,
      session: {
        consent_scopes: ['analytics'],
        consent_at: '2026-01-01T00:00:00.000Z',
        consent_provenance: { source: 'cmp' },
      },
    }),
    'info_payload_no_analytics_session_yes'
  );
});

test('evaluateConsentProvenanceShadow: ok when cmp and analytics and consent_at', () => {
  assert.equal(
    evaluateConsentProvenanceShadow({
      payloadClaimsAnalytics: true,
      session: {
        consent_scopes: ['analytics'],
        consent_at: '2026-01-01T00:00:00.000Z',
        consent_provenance: { source: 'cmp' },
      },
    }),
    'ok'
  );
});

test('evaluateConsentProvenanceShadow: noop when neither claims nor session analytics', () => {
  assert.equal(
    evaluateConsentProvenanceShadow({
      payloadClaimsAnalytics: false,
      session: {
        consent_scopes: ['marketing'],
        consent_at: '2026-01-01T00:00:00.000Z',
        consent_provenance: null,
      },
    }),
    'noop'
  );
});

test('applyConsentProvenanceShadowMetrics: increments check and outcome', () => {
  resetRefactorMetricsMemoryForTests();
  applyConsentProvenanceShadowMetrics('ok');
  const m = getRefactorMetricsMemory();
  assert.equal(m.consent_provenance_shadow_check_total, 1);
  assert.equal(m.consent_provenance_shadow_ok_total, 1);
});

test('applyConsentProvenanceShadowMetrics: noop only increments check', () => {
  resetRefactorMetricsMemoryForTests();
  applyConsentProvenanceShadowMetrics('noop');
  assert.equal(getRefactorMetricsMemory().consent_provenance_shadow_check_total, 1);
  assert.equal(getRefactorMetricsMemory().consent_provenance_shadow_mismatch_total, 0);
});
