/**
 * OCI Queue domain types and validation (shared by API routes and OCI Control UI).
 * Deterministic queue: terminal states COMPLETED | COMPLETED_UNVERIFIED | FAILED | DEAD_LETTER_QUARANTINE.
 */

import { z } from 'zod';

/** Queue row status. Terminal: COMPLETED, COMPLETED_UNVERIFIED, FAILED, DEAD_LETTER_QUARANTINE, VOIDED_BY_REVERSAL. */
export type QueueStatus =
  | 'QUEUED'
  | 'RETRY'
  | 'PROCESSING'
  | 'UPLOADED'
  | 'COMPLETED'
  | 'COMPLETED_UNVERIFIED'
  | 'FAILED'
  | 'DEAD_LETTER_QUARANTINE'
  | 'VOIDED_BY_REVERSAL'
  | 'BLOCKED_PRECEDING_SIGNALS';

/** Provider error category for FAILED rows. PERMANENT = terminal non-retry (e.g. attempt cap, manual). */
export type ProviderErrorCategory =
  | 'VALIDATION'
  | 'TRANSIENT'
  | 'RATE_LIMIT'
  | 'PERMANENT'
  | 'DETERMINISTIC_SKIP'
  | 'AUTH';

/** After this many export claims, attempt-cap escalates rows to dead-letter. */
export const MAX_ATTEMPTS = 5;

/** All valid queue statuses for validation. */
export const QUEUE_STATUSES: QueueStatus[] = [
  'QUEUED',
  'RETRY',
  'PROCESSING',
  'UPLOADED',
  'COMPLETED',
  'COMPLETED_UNVERIFIED',
  'FAILED',
  'DEAD_LETTER_QUARANTINE',
  'VOIDED_BY_REVERSAL',
  'BLOCKED_PRECEDING_SIGNALS',
];

/** All valid provider error categories. */
export const PROVIDER_ERROR_CATEGORIES: ProviderErrorCategory[] = [
  'VALIDATION',
  'TRANSIENT',
  'RATE_LIMIT',
  'PERMANENT',
  'DETERMINISTIC_SKIP',
  'AUTH',
];

// --- Zod schemas for API input ---

export const QueueStatsQuerySchema = z.object({
  siteId: z.string().min(1, 'siteId is required'),
  scope: z.enum(['site', 'multi']).optional().default('site'),
});

export const QueueRowsQuerySchema = z.object({
  siteId: z.string().min(1, 'siteId is required'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  status: z.enum(QUEUE_STATUSES as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
});

export const QueueActionSchema = z.enum([
  'RETRY_SELECTED',
  'RESET_TO_QUEUED',
  'MARK_FAILED',
]);

export const QueueActionsBodySchema = z
  .object({
    siteId: z.string().min(1, 'siteId is required'),
    action: QueueActionSchema,
    ids: z.array(z.string().uuid()).min(1, 'ids must not be empty').max(5000),
    reason: z.string().max(2048).optional(),
    errorCode: z.string().max(64).optional(),
    errorCategory: z
      .enum(PROVIDER_ERROR_CATEGORIES as [string, ...string[]])
      .optional(),
    /** Only for RESET_TO_QUEUED: clear last_error, provider_error_* (default false). */
    clearErrors: z.boolean().optional().default(false),
  })
  .strict();

export type QueueStatsQuery = z.infer<typeof QueueStatsQuerySchema>;
export type QueueRowsQuery = z.infer<typeof QueueRowsQuerySchema>;
export type QueueActionsBody = z.infer<typeof QueueActionsBodySchema>;

/** Single row shape for queue-rows API and UI. */
export interface OciQueueRow {
  id: string;
  call_id: string | null;
  status: QueueStatus;
  block_reason?: string | null;
  blocked_at?: string | null;
  provider_error_code: string | null;
  provider_error_category: ProviderErrorCategory | null;
  last_error: string | null;
  attempt_count: number;
  brain_score?: number | null;
  match_score?: number | null;
  queue_priority?: number;
  score_version?: number | null;
  score_flags?: number;
  created_at: string;
  updated_at: string;
}

/** Queue stats response. */
export interface OciQueueStats {
  siteId: string;
  /** sites.oci_sync_method — script (GAS pull) vs api (worker push); avoid dual exporters per site. */
  ociSyncMethod?: 'script' | 'api' | string;
  /** Pre-upload backlog in queue-only model: QUEUED+RETRY+PROCESSING. */
  unifiedExportBacklog?: number;
  /** Rows waiting before upload completes (SCRIPT/API still to confirm). */
  queueBacklogActive?: number;
  /** Won rows uploaded to Google, ACK pending — shown separately from backlog. */
  queueInFlightUploaded?: number;
  /** Queue: QUEUED+RETRY+PROCESSING+UPLOADED (operational totals). */
  queueExportActive?: number;
  totals: Record<QueueStatus, number>;
  stuckProcessing?: number;
  lastUpdatedAt?: string;
  outboxPending?: number;
  outboxProcessingStale?: number;
  outboxFailedRecent?: number;
  truthRepairBacklog?: number;
  outboxQueueParityRatio?: number;
  /** Oldest blocked_at among BLOCKED_PRECEDING_SIGNALS rows (ISO), if any. */
  blockedQueueOldestAt?: string | null;
  /** Seconds since oldest blocked_at (same row as blockedQueueOldestAt). */
  oldestBlockedAgeSeconds?: number | null;
  /** Counts of block_reason text among BLOCKED_PRECEDING_SIGNALS rows. */
  blockReasonBreakdown?: Record<string, number>;
  /**
   * Among the first ~500 blocked rows (scan cap), precursors no longer blocking — reconciler should promote.
   * When promotionScanCapped is true, total blocked may exceed the sample.
   */
  promotionReadyInSample?: number;
  blockedPromotionScanCapped?: boolean;
  lastQueueUploadAt?: string | null;
  lastQueueCompletedAt?: string | null;
  /** Operational queue health (contract lib/oci/queue-health-contract.ts); not lead_score / conversion value. */
  queueHealthPolicyVersion?: string;
  queue_health_status?: 'GREEN' | 'WARN' | 'RED';
  queue_health_score?: number;
  blocking_reasons?: string[];
  queued_count?: number;
  retry_count?: number;
  processing_count?: number;
  failed_count?: number;
  dlq_count?: number;
  stuck_processing_count?: number;
  oldest_queued_age_minutes?: number | null;
  oldest_retry_age_minutes?: number | null;
  oldest_processing_age_minutes?: number | null;
  retry_rate?: number;
  /** (FAILED + DLQ) / total — raw aggregate; PR-1C: use actionable_failed_rate for health gates */
  failed_rate?: number;
  total_failed_rate?: number;
  actionable_failed_rate?: number;
  provider_failed_rate?: number;
  deterministic_skip_rate?: number;
  failure_taxonomy?: {
    total_failed_count: number;
    deterministic_skip_count: number;
    suppressed_higher_gear_count: number;
    provider_failed_count: number;
    policy_failed_count: number;
    unknown_failed_count: number;
    actionable_failed_count: number;
  };
  won_missing_pipeline_count?: number;
  queue_health_evaluation_mode?: 'operational' | 'kemik';
}
