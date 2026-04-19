/**
 * Runner log helpers — SSOT for runner-specific logging shape.
 * Extracted from lib/oci/runner.ts during Phase 4 god-object split.
 */

import { logError as loggerError, logInfo } from '@/lib/logging/logger';
import type { QueueRow } from '@/lib/cron/process-offline-conversions';

export function logRunnerError(prefix: string, message: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  loggerError(message, { prefix, error: detail });
}

/** Standardized group outcome log: mode, providerKey, claimed, success, failure, retry. */
export function logGroupOutcome(
  prefix: string,
  mode: 'worker' | 'cron',
  providerKey: string,
  claimed_count: number,
  success_count: number,
  failure_count: number,
  retry_count: number
): void {
  logInfo('OCI_GROUP_OUTCOME', { prefix, mode, providerKey, claimed_count, success_count, failure_count, retry_count });
}

/** Safely read attempt_count from a queue row, falling back to a known-good value. */
export function getQueueAttemptCount(row: QueueRow, fallback: number): number {
  const raw = (row as QueueRow & { attempt_count?: number | null }).attempt_count;
  const value = raw ?? fallback;
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
