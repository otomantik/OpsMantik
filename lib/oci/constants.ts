/**
 * Shared OCI runner constants (PR-C4). Single source of truth for worker and cron.
 */

/** After this many attempts, mark job FAILED instead of RETRY. */
export const MAX_RETRY_ATTEMPTS = 7;

export const BATCH_SIZE_WORKER = 50;
export const DEFAULT_LIMIT_CRON = 50;
export const MAX_LIMIT_CRON = 500;
export const LIST_GROUPS_LIMIT = 50;
