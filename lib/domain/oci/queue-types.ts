/**
 * OCI Queue domain types and validation (shared by API routes and OCI Control UI).
 * Deterministic queue: terminal states COMPLETED | FAILED; attempt_count cap.
 */

import { z } from 'zod';

/** Queue row status. Terminal: COMPLETED, FAILED. */
export type QueueStatus =
  | 'QUEUED'
  | 'RETRY'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

/** Provider error category for FAILED rows. PERMANENT = terminal non-retry (e.g. attempt cap, manual). */
export type ProviderErrorCategory =
  | 'VALIDATION'
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'DETERMINISTIC_SKIP'
  | 'AUTH';

/** After this many export claims, attempt-cap marks row FAILED. */
export const MAX_ATTEMPTS = 5;

/** All valid queue statuses for validation. */
export const QUEUE_STATUSES: QueueStatus[] = [
  'QUEUED',
  'RETRY',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
];

/** All valid provider error categories. */
export const PROVIDER_ERROR_CATEGORIES: ProviderErrorCategory[] = [
  'VALIDATION',
  'TRANSIENT',
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

export const QueueActionsBodySchema = z.object({
  siteId: z.string().min(1, 'siteId is required'),
  action: QueueActionSchema,
  ids: z.array(z.string().uuid()).min(1, 'ids must not be empty'),
  reason: z.string().optional(),
  errorCode: z.string().optional(),
  errorCategory: z
    .enum(PROVIDER_ERROR_CATEGORIES as [string, ...string[]])
    .optional(),
  /** Only for RESET_TO_QUEUED: clear last_error, provider_error_* (default false). */
  clearErrors: z.boolean().optional().default(false),
});

export type QueueStatsQuery = z.infer<typeof QueueStatsQuerySchema>;
export type QueueRowsQuery = z.infer<typeof QueueRowsQuerySchema>;
export type QueueActionsBody = z.infer<typeof QueueActionsBodySchema>;

/** Single row shape for queue-rows API and UI. */
export interface OciQueueRow {
  id: string;
  call_id: string | null;
  status: QueueStatus;
  provider_error_code: string | null;
  provider_error_category: ProviderErrorCategory | null;
  last_error: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

/** Queue stats response. */
export interface OciQueueStats {
  siteId: string;
  totals: Record<QueueStatus, number>;
  stuckProcessing?: number;
  lastUpdatedAt?: string;
}
