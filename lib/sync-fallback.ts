/**
 * Server-side fallback: when QStash publish fails, we persist the worker payload
 * to ingest_fallback_buffer for recovery cron. This module defines the row shape.
 */

export type FallbackRowInsert = {
  site_id: string;
  payload: Record<string, unknown>;
  error_reason: string | null;
  status: 'PENDING';
};

/**
 * Build the insert row for ingest_fallback_buffer (used by /api/sync catch block).
 */
export function buildFallbackRow(
  siteIdUuid: string,
  workerPayload: Record<string, unknown>,
  errorReason: string | null
): FallbackRowInsert {
  return {
    site_id: siteIdUuid,
    payload: workerPayload,
    error_reason: errorReason,
    status: 'PENDING',
  };
}
