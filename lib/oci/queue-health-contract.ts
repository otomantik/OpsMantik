/**
 * Queue Health contract (v1) — operational reliability only.
 * Not lead_score, not Google conversion value — see docs/architecture/CLOSED_SYSTEM_SCORE_CONTRACT.md
 *
 * Kemik “100” definition: docs/architecture/OCI_QUEUE_HEALTH.md (same invariants as evaluateQueueHealth).
 */

export const QUEUE_HEALTH_POLICY_VERSION = 'queue_health_contract_v1' as const;

/** Rollout script stuck threshold uses wall clock from row `updated_at` (aligned with queue-stats). */
export const STUCK_PROCESSING_MAX_AGE_MINUTES = 15;

/** Max age for oldest QUEUED row (minutes) before QUEUED_TOO_OLD — operational SLO, v1 default 7d. */
export const QUEUE_HEALTH_MAX_QUEUED_AGE_MINUTES = 7 * 24 * 60;

/** Max age for oldest RETRY row (minutes) — v1 default 7d. */
export const QUEUE_HEALTH_MAX_RETRY_AGE_MINUTES = 7 * 24 * 60;

/**
 * Max “age” for oldest PROCESSING row for backlog freshness (minutes).
 * Must be <= STUCK_PROCESSING_MAX_AGE_MINUTES when non-stuck invariant holds; kept equal for v1.
 */
export const QUEUE_HEALTH_MAX_PROCESSING_AGE_FOR_FRESHNESS_MINUTES = STUCK_PROCESSING_MAX_AGE_MINUTES;

/** Same formula as scripts/oci-rollout-readiness: retry_rate = RETRY / totalQueue */
export const QUEUE_HEALTH_MAX_RETRY_RATE = 0.3;

/** failed_rate = (FAILED + DLQ) / totalQueue in rollout; dlq = DEAD_LETTER_QUARANTINE */
export const QUEUE_HEALTH_MAX_FAILED_RATE = 0.2;

export type QueueHealthStatus = 'GREEN' | 'WARN' | 'RED';

export type QueueHealthReason =
  | 'STUCK_PROCESSING'
  | 'WON_MISSING_PIPELINE'
  | 'QUEUED_TOO_OLD'
  | 'RETRY_TOO_OLD'
  | 'PROCESSING_BACKLOG_STALE'
  | 'RETRY_RATE_HIGH'
  | 'FAILED_RATE_HIGH'
  | 'DLQ_UNREVIEWED'
  | 'TIME_SSOT_RED'
  | 'VALUE_INTEGRITY_RED'
  | 'IDENTITY_INTEGRITY_RED'
  | 'RPC_CONTRACT_RED'
  | 'DB_NOT_CHECKED'
  | 'UNKNOWN';

export const QUEUE_HEALTH_REASONS = [
  'STUCK_PROCESSING',
  'WON_MISSING_PIPELINE',
  'QUEUED_TOO_OLD',
  'RETRY_TOO_OLD',
  'PROCESSING_BACKLOG_STALE',
  'RETRY_RATE_HIGH',
  'FAILED_RATE_HIGH',
  'DLQ_UNREVIEWED',
  'TIME_SSOT_RED',
  'VALUE_INTEGRITY_RED',
  'IDENTITY_INTEGRITY_RED',
  'RPC_CONTRACT_RED',
  'DB_NOT_CHECKED',
  'UNKNOWN',
] as const satisfies readonly QueueHealthReason[];

export type QueueHealthScore = number;

export type RolloutProfile = 'dev' | 'stage' | 'prod';

/** Tolerances for deploy/gate smoke — NOT the same as “Queue Health 100” (stuck must be 0 for 100). */
export const ROLLOUT_PROFILE_DEFAULTS: Record<
  RolloutProfile,
  { stuckMax: number; retryRateMax: number; failedRateMax: number }
> = {
  dev: { stuckMax: 50, retryRateMax: 0.5, failedRateMax: 0.35 },
  stage: { stuckMax: 30, retryRateMax: 0.4, failedRateMax: 0.25 },
  prod: { stuckMax: 20, retryRateMax: QUEUE_HEALTH_MAX_RETRY_RATE, failedRateMax: QUEUE_HEALTH_MAX_FAILED_RATE },
};

export interface QueueHealthEvidenceFlags {
  /** false = cannot claim score 100 (release / strict evaluation). */
  targetDbEvidenceAvailable: boolean;
}

export interface QueueHealthSsoTFlags {
  /** When false/undefined, cannot certify 100 (use evidence SQL packs for full SSOT). */
  ssotEvaluated?: boolean;
  timeSsotRed?: boolean;
  valueIntegrityRed?: boolean;
  identityIntegrityRed?: boolean;
}

export type QueueHealthEvaluationMode = 'operational' | 'kemik';

export interface QueueHealthMetricInput extends QueueHealthEvidenceFlags, QueueHealthSsoTFlags {
  /** `kemik` = release / TARGET_DB 100 seal (requires full SSOT coverage). `operational` = queue-stats API default. */
  evaluationMode?: QueueHealthEvaluationMode;
  siteId: string;
  stuckProcessingCount: number;
  wonMissingPipelineCount: number;
  oldestQueuedAgeMinutes: number | null;
  oldestRetryAgeMinutes: number | null;
  oldestProcessingAgeMinutes: number | null;
  /** Rollout-aligned: total rows in offline_conversion_queue for site */
  totalQueue: number;
  retryCount: number;
  failedCount: number;
  deadLetterQuarantineCount: number;
}

export interface QueueHealthEvaluation {
  policy_version: typeof QUEUE_HEALTH_POLICY_VERSION;
  queue_health_status: QueueHealthStatus;
  queue_health_score: QueueHealthScore;
  blocking_reasons: QueueHealthReason[];
  retry_rate: number;
  failed_rate: number;
}

export function computeRetryFailedRates(input: {
  totalQueue: number;
  retryCount: number;
  failedCount: number;
  deadLetterQuarantineCount: number;
}): { retry_rate: number; failed_rate: number } {
  const total = input.totalQueue;
  if (total <= 0) {
    return { retry_rate: 0, failed_rate: 0 };
  }
  return {
    retry_rate: input.retryCount / total,
    failed_rate: (input.failedCount + input.deadLetterQuarantineCount) / total,
  };
}

/**
 * v1: any hard invariant failure → status RED and score 0 (simple, auditable).
 * Score 100 only when GREEN and no blocking reasons.
 */
export function evaluateQueueHealth(metrics: QueueHealthMetricInput): QueueHealthEvaluation {
  const mode: QueueHealthEvaluationMode = metrics.evaluationMode ?? 'operational';
  const reasons: QueueHealthReason[] = [];
  const { retry_rate, failed_rate } = computeRetryFailedRates({
    totalQueue: metrics.totalQueue,
    retryCount: metrics.retryCount,
    failedCount: metrics.failedCount,
    deadLetterQuarantineCount: metrics.deadLetterQuarantineCount,
  });

  if (mode === 'kemik' && !metrics.targetDbEvidenceAvailable) {
    reasons.push('DB_NOT_CHECKED');
  }
  if (metrics.stuckProcessingCount > 0) {
    reasons.push('STUCK_PROCESSING');
  }
  if (metrics.wonMissingPipelineCount > 0) {
    reasons.push('WON_MISSING_PIPELINE');
  }
  if (
    metrics.oldestQueuedAgeMinutes != null &&
    metrics.oldestQueuedAgeMinutes > QUEUE_HEALTH_MAX_QUEUED_AGE_MINUTES
  ) {
    reasons.push('QUEUED_TOO_OLD');
  }
  if (
    metrics.oldestRetryAgeMinutes != null &&
    metrics.oldestRetryAgeMinutes > QUEUE_HEALTH_MAX_RETRY_AGE_MINUTES
  ) {
    reasons.push('RETRY_TOO_OLD');
  }
  if (
    metrics.oldestProcessingAgeMinutes != null &&
    metrics.oldestProcessingAgeMinutes > QUEUE_HEALTH_MAX_PROCESSING_AGE_FOR_FRESHNESS_MINUTES
  ) {
    reasons.push('PROCESSING_BACKLOG_STALE');
  }
  if (retry_rate > QUEUE_HEALTH_MAX_RETRY_RATE) {
    reasons.push('RETRY_RATE_HIGH');
  }
  if (failed_rate > QUEUE_HEALTH_MAX_FAILED_RATE) {
    reasons.push('FAILED_RATE_HIGH');
  }
  if (metrics.deadLetterQuarantineCount > 0) {
    reasons.push('DLQ_UNREVIEWED');
  }
  if (mode === 'kemik') {
    if (metrics.ssotEvaluated !== true) {
      reasons.push('UNKNOWN');
    } else {
      if (metrics.timeSsotRed) reasons.push('TIME_SSOT_RED');
      if (metrics.valueIntegrityRed) reasons.push('VALUE_INTEGRITY_RED');
      if (metrics.identityIntegrityRed) reasons.push('IDENTITY_INTEGRITY_RED');
    }
  } else {
    if (metrics.timeSsotRed) reasons.push('TIME_SSOT_RED');
    if (metrics.valueIntegrityRed) reasons.push('VALUE_INTEGRITY_RED');
    if (metrics.identityIntegrityRed) reasons.push('IDENTITY_INTEGRITY_RED');
  }

  const distinct = [...new Set(reasons)];
  const blocking = distinct;
  const green = blocking.length === 0;
  return {
    policy_version: QUEUE_HEALTH_POLICY_VERSION,
    queue_health_status: green ? 'GREEN' : 'RED',
    queue_health_score: green ? 100 : 0,
    blocking_reasons: blocking,
    retry_rate,
    failed_rate,
  };
}

/**
 * Rollout gate only — uses profile tolerances (stuck may be >0 and still pass).
 */
export function evaluateRolloutGate(input: {
  stuckProcessing: number;
  retryRate: number;
  failedRate: number;
  profile: RolloutProfile;
  overrides?: Partial<{ stuckMax: number; retryRateMax: number; failedRateMax: number }>;
}): { pass: boolean; failures: string[] } {
  const defaults = ROLLOUT_PROFILE_DEFAULTS[input.profile] ?? ROLLOUT_PROFILE_DEFAULTS.prod;
  const stuckMax = input.overrides?.stuckMax ?? defaults.stuckMax;
  const retryRateMax = input.overrides?.retryRateMax ?? defaults.retryRateMax;
  const failedRateMax = input.overrides?.failedRateMax ?? defaults.failedRateMax;
  const failures: string[] = [];
  if (input.stuckProcessing > stuckMax) failures.push(`stuckProcessing>${stuckMax}`);
  if (input.retryRate > retryRateMax) failures.push(`retryRate>${retryRateMax}`);
  if (input.failedRate > failedRateMax) failures.push(`failedRate>${failedRateMax}`);
  return { pass: failures.length === 0, failures };
}
