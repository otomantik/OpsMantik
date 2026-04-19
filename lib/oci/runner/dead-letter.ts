/**
 * Runner dead-letter audit — write DLQ rows when queue jobs are permanently failed.
 * Extracted from lib/oci/runner.ts during Phase 4 god-object split.
 */

import type { QueueRow } from '@/lib/cron/process-offline-conversions';
import { insertDeadLetterAuditLogs } from '@/lib/oci/dead-letter-audit';
import { getQueueAttemptCount } from './log-helpers';

export async function writeQueueDeadLetterAudit(
  siteId: string,
  rows: QueueRow[],
  errorCode: string,
  errorMessage: string,
  errorCategory: 'PERMANENT' | 'VALIDATION' | 'AUTH' | 'MAX_ATTEMPTS'
): Promise<void> {
  if (rows.length === 0) return;

  await insertDeadLetterAuditLogs(
    rows.map((row) => ({
      siteId,
      resourceType: 'oci_queue',
      resourceId: row.id,
      callId: row.call_id,
      errorCode,
      errorMessage,
      errorCategory,
      attemptCount: getQueueAttemptCount(row, row.retry_count ?? 0),
      pipeline: 'WORKER',
    }))
  );
}
