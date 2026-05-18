import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyRolloutGateFailureString,
  derivePrimaryRolloutMetricClassFromRolloutJson,
  derivePrimaryStrictFleetClassFromRolloutJson,
  extractJsonObjectFromMixedOutput,
} from '../../lib/oci/rollout-readiness-triage';

const ROOT = process.cwd();

test('extractJsonObjectFromMixedOutput skips dotenv prefix lines', () => {
  const raw =
    '[dotenv] injecting env\n{"reports":[{"gate":{"pass":false,"failures":["wonMissingPipeline>0"]}}],"strict":{"failures":["observability_gate_failures_present"]}}';
  const json = extractJsonObjectFromMixedOutput(raw);
  assert.ok(json?.reports?.length === 1);
});

test('TS rollout JSON triage matches gate failure tokens', () => {
  const json = {
    reports: [{ gate: { pass: false, failures: ['wonMissingPipeline>0'] } }],
    strict: { failures: ['observability_gate_failures_present'] },
  };
  assert.equal(classifyRolloutGateFailureString('wonMissingPipeline>0'), 'RED_METRIC_WON_PIPELINE_LEAK');
  assert.equal(derivePrimaryRolloutMetricClassFromRolloutJson(json), 'RED_METRIC_WON_PIPELINE_LEAK');
  assert.equal(derivePrimaryStrictFleetClassFromRolloutJson(json), 'RED_METRIC_WON_PIPELINE_LEAK');
});

test('collect-gate-evidence delegates rollout strict check to triage module', () => {
  const evidence = readFileSync(join(ROOT, 'scripts/release/collect-gate-evidence.mjs'), 'utf8');
  const triage = readFileSync(join(ROOT, 'scripts/release/rollout-readiness-evidence-triage.mjs'), 'utf8');
  assert.ok(evidence.includes("from './rollout-readiness-evidence-triage.mjs'"));
  assert.ok(evidence.includes('runOciRolloutReadinessStrictCheck'));
  assert.ok(!evidence.includes('function classifyRolloutGateFailureStringJs'));
  assert.ok(triage.includes('export function runOciRolloutReadinessStrictCheck'));
  assert.ok(triage.includes('wonMissingPipeline>'));
});

test('evidence-contracts exports mapRolloutPrimaryClassToReasonCode', () => {
  const contracts = readFileSync(join(ROOT, 'scripts/release/evidence-contracts.mjs'), 'utf8');
  assert.ok(contracts.includes('export function mapRolloutPrimaryClassToReasonCode'));
});
