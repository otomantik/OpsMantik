/**
 * PR-9J — rollout strict smoke parsing for release evidence.
 * @sync lib/oci/rollout-readiness-triage.ts
 */
import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { REASON_CODES, mapRolloutPrimaryClassToReasonCode } from './evidence-contracts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

/**
 * @sync lib/oci/rollout-readiness-triage.ts — `classifyRolloutGateFailureString`
 */
export function classifyRolloutGateFailureStringJs(failure) {
  if (typeof failure !== 'string') return 'RED_METRIC_UNKNOWN';
  if (failure.startsWith('stuckProcessing>')) return 'RED_METRIC_STUCK_PROCESSING';
  if (failure.startsWith('retryRate>')) return 'RED_METRIC_RETRY_RATE_HIGH';
  if (failure.startsWith('actionableFailedRate>')) return 'RED_METRIC_ACTIONABLE_REAL';
  if (failure.startsWith('providerFailedRate>')) return 'RED_METRIC_PROVIDER_RISK';
  if (failure === 'unknownFailedCount>0') return 'RED_METRIC_UNKNOWN_FAILED';
  if (failure.startsWith('wonMissingPipeline>')) return 'RED_METRIC_WON_PIPELINE_LEAK';
  if (failure.startsWith('deadLetterQuarantine>')) return 'RED_METRIC_DLQ_PRESENT';
  return 'RED_METRIC_UNKNOWN';
}

/**
 * @sync lib/oci/rollout-readiness-triage.ts — `derivePrimaryRolloutMetricClassFromReports`
 */
export function derivePrimaryRolloutMetricClassFromRolloutJson(json) {
  const reports = Array.isArray(json?.reports) ? json.reports : [];
  const failing = reports.filter((r) => r && r.gate && r.gate.pass === false);
  if (failing.length === 0) return 'RED_METRIC_UNKNOWN';
  const classes = new Set();
  for (const r of failing) {
    const failures = Array.isArray(r.gate.failures) ? r.gate.failures : [];
    for (const f of failures) classes.add(classifyRolloutGateFailureStringJs(f));
  }
  if (classes.has('RED_METRIC_UNKNOWN_FAILED')) return 'RED_METRIC_UNKNOWN_FAILED';
  if (classes.has('RED_METRIC_PROVIDER_RISK')) return 'RED_METRIC_PROVIDER_RISK';
  if (classes.has('RED_METRIC_DLQ_PRESENT')) return 'RED_METRIC_DLQ_PRESENT';
  if (classes.has('RED_METRIC_WON_PIPELINE_LEAK')) return 'RED_METRIC_WON_PIPELINE_LEAK';
  if (classes.has('RED_METRIC_STUCK_PROCESSING')) return 'RED_METRIC_STUCK_PROCESSING';
  if (classes.has('RED_METRIC_ACTIONABLE_REAL')) return 'RED_METRIC_ACTIONABLE_REAL';
  if (classes.has('RED_METRIC_RETRY_RATE_HIGH')) return 'RED_METRIC_RETRY_RATE_HIGH';
  return 'RED_METRIC_UNKNOWN';
}

/**
 * @sync lib/oci/rollout-readiness-triage.ts — `derivePrimaryStrictFleetClass`
 */
export function derivePrimaryStrictFleetClassFromRolloutJson(json) {
  const strictFailures = Array.isArray(json?.strict?.failures) ? json.strict.failures : [];
  const reports = Array.isArray(json?.reports) ? json.reports : [];
  if (strictFailures.length === 0) return null;
  if (strictFailures.includes('schema_drift_detected')) return 'RED_METRIC_SCHEMA_DRIFT';
  if (
    strictFailures.includes('missing_api_key_sites') ||
    strictFailures.includes('missing_google_ads_sync_capability') ||
    strictFailures.includes('missing_entitlement_rpc')
  ) {
    return 'RED_METRIC_AUTH_OR_ENTITLEMENT';
  }
  if (strictFailures.includes('no_canary_candidate')) return 'RED_METRIC_NO_CANARY';
  if (strictFailures.includes('no_sites_found') || strictFailures.includes('no_auth_ready_sites')) {
    return 'RED_METRIC_FLEET_STRICT_OTHER';
  }
  if (strictFailures.includes('observability_gate_failures_present')) {
    return derivePrimaryRolloutMetricClassFromRolloutJson(json);
  }
  return 'RED_METRIC_FLEET_STRICT_OTHER';
}

/** @sync lib/oci/rollout-readiness-triage.ts — `extractJsonObjectFromMixedOutput` */
export function extractJsonObjectFromMixedOutput(s) {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function runOciRolloutReadinessStrictCheck(commandLabel) {
  const cmd = 'npx tsx scripts/oci-rollout-readiness.ts --strict --json';
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync(cmd, {
    cwd: repoRoot,
    shell: true,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedMs;
  const out = `${result.stdout || ''}${result.stderr || ''}`.trim();
  const json = extractJsonObjectFromMixedOutput(out);
  const exit = result.status ?? 1;
  const ok = exit === 0;
  let reasonCode = ok ? null : REASON_CODES.RED_METRIC;
  let primaryClass = null;
  if (json && !ok) {
    primaryClass =
      json?.strict?.triage?.primary_red_metric_class ?? derivePrimaryStrictFleetClassFromRolloutJson(json);
    if (typeof primaryClass === 'string') {
      reasonCode = mapRolloutPrimaryClassToReasonCode(primaryClass);
    }
  }
  return {
    name: commandLabel || 'npm run smoke:oci-rollout-readiness:strict',
    started_at: startedAt,
    duration_ms: durationMs,
    exit_code: exit,
    status: ok ? 'PASS' : 'FAIL',
    output: out,
    reason_code: reasonCode,
    rollout_readiness_triage: json?.strict?.triage ?? null,
    rollout_readiness_primary_class: primaryClass,
  };
}
