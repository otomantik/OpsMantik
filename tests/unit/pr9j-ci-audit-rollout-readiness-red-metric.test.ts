/**
 * PR-9J.CI-AUDIT-P1.1 — rollout readiness RED_METRIC triage + retry-rate pipeline exemption.
 */

import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRolloutGate } from '@/lib/oci/queue-health-contract';
import {
  buildFleetGateSiteTriage,
  classifyRolloutGateFailureString,
  countPipelineClassifiedRetryRows,
  derivePrimaryRolloutMetricClassFromReports,
  derivePrimaryStrictFleetClass,
} from '@/lib/oci/rollout-readiness-triage';

test('deterministic-only FAILED taxonomy: actionable/provider/unknown zero — gate passes failed-rate thresholds', () => {
  const g = evaluateRolloutGate({
    stuckProcessing: 0,
    retryRate: 0,
    actionableFailedRate: 0,
    providerFailedRate: 0,
    unknownFailedCount: 0,
    wonMissingPipelineCount: 0,
    deadLetterQuarantineCount: 0,
    profile: 'prod',
  });
  assert.equal(g.pass, true);
});

test('unknown failed count > 0 blocks rollout gate', () => {
  const g = evaluateRolloutGate({
    stuckProcessing: 0,
    retryRate: 0,
    actionableFailedRate: 0,
    providerFailedRate: 0,
    unknownFailedCount: 1,
    wonMissingPipelineCount: 0,
    deadLetterQuarantineCount: 0,
    profile: 'prod',
  });
  assert.equal(g.pass, false);
  assert.ok(g.failures.includes('unknownFailedCount>0'));
});

test('provider failed rate above max blocks', () => {
  const g = evaluateRolloutGate({
    stuckProcessing: 0,
    retryRate: 0,
    actionableFailedRate: 0,
    providerFailedRate: 0.25,
    unknownFailedCount: 0,
    wonMissingPipelineCount: 0,
    deadLetterQuarantineCount: 0,
    profile: 'prod',
  });
  assert.equal(g.pass, false);
});

test('actionable failed rate above max blocks', () => {
  const g = evaluateRolloutGate({
    stuckProcessing: 0,
    retryRate: 0,
    actionableFailedRate: 0.25,
    providerFailedRate: 0,
    unknownFailedCount: 0,
    wonMissingPipelineCount: 0,
    deadLetterQuarantineCount: 0,
    profile: 'prod',
  });
  assert.equal(g.pass, false);
});

test('stuck processing above profile max blocks', () => {
  const g = evaluateRolloutGate({
    stuckProcessing: 25,
    retryRate: 0,
    actionableFailedRate: 0,
    providerFailedRate: 0,
    unknownFailedCount: 0,
    wonMissingPipelineCount: 0,
    deadLetterQuarantineCount: 0,
    profile: 'prod',
  });
  assert.equal(g.pass, false);
});

test('retry rate: combined exempt (stale recovery + pipeline RETRY) can pass gate', () => {
  const g = evaluateRolloutGate({
    stuckProcessing: 0,
    retryRate: 0.36,
    retryRateExempt: 0.36,
    actionableFailedRate: 0,
    providerFailedRate: 0,
    unknownFailedCount: 0,
    wonMissingPipelineCount: 0,
    deadLetterQuarantineCount: 0,
    profile: 'prod',
  });
  assert.equal(g.pass, true);
});

test('countPipelineClassifiedRetryRows counts TRANSIENT/RATE_LIMIT/AUTH RETRY only', () => {
  const rows = [
    { status: 'RETRY', provider_error_category: 'TRANSIENT' },
    { status: 'RETRY', provider_error_category: 'RATE_LIMIT' },
    { status: 'RETRY', provider_error_category: 'AUTH' },
    { status: 'RETRY', provider_error_category: null },
    { status: 'RETRY', provider_error_category: 'VALIDATION' },
    { status: 'QUEUED', provider_error_category: 'TRANSIENT' },
  ];
  assert.equal(countPipelineClassifiedRetryRows(rows), 3);
});

test('derivePrimaryRolloutMetricClassFromReports: unknown beats retry', () => {
  const cls = derivePrimaryRolloutMetricClassFromReports([
    { gate: { pass: false, failures: ['retryRate>0.3'] } },
    { gate: { pass: false, failures: ['unknownFailedCount>0'] } },
  ]);
  assert.equal(cls, 'RED_METRIC_UNKNOWN_FAILED');
});

test('buildFleetGateSiteTriage exposes stable site_label and failure strings (no raw secrets)', () => {
  const t = buildFleetGateSiteTriage([
    {
      site: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', public_id: 'pub1', name: 'Site A' },
      gate: { pass: false, failures: ['retryRate>0.3'] },
    },
  ]);
  assert.equal(t.length, 1);
  assert.equal(t[0].site_label, 'Site A');
  assert.equal(t[0].primary_class, 'RED_METRIC_RETRY_RATE_HIGH');
});

test('derivePrimaryStrictFleetClass: schema drift before observability merge', () => {
  const c = derivePrimaryStrictFleetClass(['observability_gate_failures_present', 'schema_drift_detected'], [
    { gate: { pass: false, failures: ['retryRate>0.3'] } },
  ]);
  assert.equal(c, 'RED_METRIC_SCHEMA_DRIFT');
});

test('classifyRolloutGateFailureString: unknown token maps to RED_METRIC_UNKNOWN', () => {
  assert.equal(classifyRolloutGateFailureString('weird>1'), 'RED_METRIC_UNKNOWN');
});
