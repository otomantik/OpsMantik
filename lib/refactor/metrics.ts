/**
 * Parity / drift metric scaffolding for the truth-engine refactor (Phase 0+).
 * Same persistence pattern as route-metrics: Redis when available, in-memory fallback.
 */

import { logDebug } from '@/lib/logging/logger';
import { redis } from '@/lib/upstash';

const PREFIX = 'refactor:';
const TTL_SEC = 365 * 24 * 60 * 60;

/** Counter names reserved for the refactor program. */
export const REFACTOR_METRIC_NAMES = [
  'truth_shadow_write_attempt_total',
  'truth_typed_evidence_shadow_total',
  'truth_typed_evidence_validation_fail_total',
  'truth_inference_registry_probe_total',
  'truth_projection_read_probe_total',
  'truth_projection_drift_total',
  'identity_graph_probe_total',
  'explainability_api_probe_total',
  'truth_refactor_instrumented_touch_total',
  'consent_provenance_shadow_check_total',
  'consent_provenance_shadow_missing_session_total',
  'consent_provenance_shadow_mismatch_total',
  'consent_provenance_shadow_low_trust_total',
  'consent_provenance_shadow_payload_no_analytics_session_yes_total',
  'consent_provenance_shadow_ok_total',
  'consent_provenance_gdpr_malformed_body_total',
  'truth_canonical_ledger_attempt_total',
  'truth_canonical_ledger_success_total',
  'truth_canonical_ledger_failure_total',
  'truth_engine_consolidated_probe_total',
  'truth_engine_consolidated_attribution_parity_check_total',
  'truth_engine_consolidated_attribution_parity_match_total',
  'truth_engine_consolidated_attribution_parity_mismatch_total',
  'truth_engine_consolidated_call_event_parity_check_total',
  'truth_engine_consolidated_call_event_parity_match_total',
  'truth_engine_consolidated_call_event_parity_mismatch_total',
  'truth_engine_scoring_lineage_parity_check_total',
  'truth_engine_scoring_lineage_parity_match_total',
  'truth_engine_scoring_lineage_parity_mismatch_total',
  'truth_engine_scoring_lineage_parity_skipped_total',
  'mutation_version_missing_total',
  'mutation_version_zero_total',
  'mutation_version_invalid_total',
  'mutation_conflict_total',
  'mutation_compat_bypass_used_total',
  'truth_parity_mismatch_total',
  'truth_repair_backlog',
  'truth_repair_success_total',
  'lease_acquire_success',
  'lease_acquire_denied',
  'lease_steal_total',
  'lease_heartbeat_lag_ms',
  'fastpath_unclaimed_reject_total',
  'queue_terminal_without_claim_total',
  'timezone_fallback_used_total',
  'truth_repair_queue_upsert_failed_total',
  'truth_repair_reclaim_total',
  'truth_repair_dead_letter_total',
  'won_error_swallowed_total',
  'queue_action_denied_readonly_total',
  'queue_action_conflict_total',
  'queue_action_missing_intent_total',
] as const;

export type RefactorMetricName = (typeof REFACTOR_METRIC_NAMES)[number];

const mem = Object.fromEntries(REFACTOR_METRIC_NAMES.map((k) => [k, 0])) as Record<RefactorMetricName, number>;

function redisKey(metric: RefactorMetricName): string {
  return PREFIX + metric;
}

/** Monotonic counter increment (best-effort Redis + memory). */
export function incrementRefactorMetric(name: RefactorMetricName, value = 1): void {
  if (value === 0) return;
  mem[name] = (mem[name] ?? 0) + value;
  logDebug('REFACTOR_METRIC', { metric: name, value });

  const key = redisKey(name);
  const pipe = redis.pipeline();
  // Use incr (not incrby): matches route-metrics and the no-creds Redis stub in lib/upstash.ts.
  for (let i = 0; i < value; i++) {
    pipe.incr(key);
  }
  pipe.expire(key, TTL_SEC);
  pipe.exec().catch(() => {
    /* best-effort */
  });
}

export function getRefactorMetricsMemory(): Record<RefactorMetricName, number> {
  return { ...mem };
}

/** Test-only: zero in-memory counters (parallel test isolation). */
export function resetRefactorMetricsMemoryForTests(): void {
  for (const name of REFACTOR_METRIC_NAMES) mem[name] = 0;
}

export async function getRefactorMetricsFromRedis(): Promise<Record<RefactorMetricName, number> | null> {
  const keys = REFACTOR_METRIC_NAMES.map(redisKey);
  try {
    const values = await redis.mget(...keys);
    const out = {} as Record<RefactorMetricName, number>;
    REFACTOR_METRIC_NAMES.forEach((name, i) => {
      const v = values?.[i];
      const n = typeof v === 'number' ? v : Number(v);
      out[name] = Number.isFinite(n) ? n : 0;
    });
    return out;
  } catch {
    return null;
  }
}
