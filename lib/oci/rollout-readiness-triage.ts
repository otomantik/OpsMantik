/**
 * PR-9J.CI-AUDIT-P1.1 — Rollout strict smoke triage (read-only classification).
 * Maps gate failure tokens to stable reason codes for evidence / operators (no PII).
 *
 * @sync scripts/release/collect-gate-evidence.mjs — `derivePrimaryRolloutMetricClassFromRolloutJson`
 *   must apply the same severity ordering when parsing strict JSON output.
 */

/** Categories on RETRY rows that indicate provider/backpressure pipeline backlog (not unknown taxonomy). */
export const ROLLOUT_RETRY_PIPELINE_EXEMPT_CATEGORIES = ['TRANSIENT', 'RATE_LIMIT', 'AUTH'] as const;

export type RolloutRedMetricClass =
  | 'RED_METRIC_ACTIONABLE_REAL'
  | 'RED_METRIC_PROVIDER_RISK'
  | 'RED_METRIC_STUCK_PROCESSING'
  | 'RED_METRIC_RETRY_RATE_HIGH'
  | 'RED_METRIC_WON_PIPELINE_LEAK'
  | 'RED_METRIC_DLQ_PRESENT'
  | 'RED_METRIC_UNKNOWN_FAILED'
  | 'RED_METRIC_SCHEMA_DRIFT'
  | 'RED_METRIC_AUTH_OR_ENTITLEMENT'
  | 'RED_METRIC_NO_CANARY'
  | 'RED_METRIC_FLEET_STRICT_OTHER'
  | 'RED_METRIC_UNKNOWN';

function tokenFromFailureString(f: string): string | null {
  if (f.startsWith('stuckProcessing>')) return 'stuckProcessing';
  if (f.startsWith('retryRate>')) return 'retryRate';
  if (f.startsWith('actionableFailedRate>')) return 'actionableFailedRate';
  if (f.startsWith('providerFailedRate>')) return 'providerFailedRate';
  if (f === 'unknownFailedCount>0') return 'unknownFailedCount';
  if (f.startsWith('wonMissingPipeline>')) return 'wonMissingPipeline';
  if (f.startsWith('deadLetterQuarantine>')) return 'deadLetterQuarantine';
  return null;
}

export function classifyRolloutGateFailureString(failure: string): RolloutRedMetricClass {
  const t = tokenFromFailureString(failure);
  if (t === 'stuckProcessing') return 'RED_METRIC_STUCK_PROCESSING';
  if (t === 'retryRate') return 'RED_METRIC_RETRY_RATE_HIGH';
  if (t === 'actionableFailedRate') return 'RED_METRIC_ACTIONABLE_REAL';
  if (t === 'providerFailedRate') return 'RED_METRIC_PROVIDER_RISK';
  if (t === 'unknownFailedCount') return 'RED_METRIC_UNKNOWN_FAILED';
  if (t === 'wonMissingPipeline') return 'RED_METRIC_WON_PIPELINE_LEAK';
  if (t === 'deadLetterQuarantine') return 'RED_METRIC_DLQ_PRESENT';
  return 'RED_METRIC_UNKNOWN';
}

/** Severity merge when multiple sites fail: unknown > provider > dlq > won > stuck > actionable > retry. */
export function derivePrimaryRolloutMetricClassFromReports(
  reports: Array<{ gate: { pass: boolean; failures: string[] } }>
): RolloutRedMetricClass {
  const failing = reports.filter((r) => !r.gate.pass);
  if (failing.length === 0) return 'RED_METRIC_UNKNOWN';
  const classes = new Set<RolloutRedMetricClass>();
  for (const r of failing) {
    for (const f of r.gate.failures) {
      classes.add(classifyRolloutGateFailureString(f));
    }
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

export function derivePrimaryStrictFleetClass(
  strictFailures: string[],
  reports: Array<{ gate: { pass: boolean; failures: string[] } }>
): RolloutRedMetricClass | null {
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
    return derivePrimaryRolloutMetricClassFromReports(reports);
  }
  return 'RED_METRIC_FLEET_STRICT_OTHER';
}

/**
 * RETRY rows already classified as provider/backpressure may be excluded from the rollout
 * retry-rate gate when they carry the same category signals used elsewhere for provider slices (PR-1C).
 */
export function countPipelineClassifiedRetryRows(
  rows: Array<{ status?: string | null; provider_error_category?: string | null }>
): number {
  const allow = new Set<string>(ROLLOUT_RETRY_PIPELINE_EXEMPT_CATEGORIES);
  let n = 0;
  for (const r of rows) {
    if (r.status !== 'RETRY') continue;
    const cat = typeof r.provider_error_category === 'string' ? r.provider_error_category.trim() : '';
    if (allow.has(cat)) n += 1;
  }
  return n;
}

export type FleetGateSiteTriage = {
  site_label: string;
  failures: string[];
  primary_class: RolloutRedMetricClass;
};

export function buildFleetGateSiteTriage(
  reports: Array<{
    site: { name: string | null; public_id: string | null; id: string };
    gate: { pass: boolean; failures: string[] };
  }>
): FleetGateSiteTriage[] {
  return reports
    .filter((r) => !r.gate.pass)
    .map((r) => ({
      site_label: r.site.name || r.site.public_id || r.site.id.slice(0, 8),
      failures: [...r.gate.failures],
      primary_class:
        r.gate.failures.length > 0 ? classifyRolloutGateFailureString(r.gate.failures[0]) : 'RED_METRIC_UNKNOWN',
    }));
}
