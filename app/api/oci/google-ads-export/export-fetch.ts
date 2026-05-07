import { adminClient } from '@/lib/supabase/admin';
import {
  isMissingOciRelationError,
  supabaseErrorToError,
} from '@/lib/oci/format-supabase-error';
import type { QueueRow } from '@/lib/oci/google-ads-export/types';
import { ExportHttpError, type ExportAuthContext } from './export-auth';

const EXPORT_QUEUE_LIMIT = 1000;

/**
 * Google Ads offline export reads **only** `offline_conversion_queue` (journal SSOT).
 * Legacy `marketing_signals` is not an upload surface; use pulse/recovery for that table.
 */
export type FetchedExportData = {
  rawList: QueueRow[];
};

export async function fetchExportData(ctx: ExportAuthContext): Promise<FetchedExportData> {
  const queueLimit = Math.min(EXPORT_QUEUE_LIMIT, Math.max(1, ctx.pageLimit));
  let queueQuery = adminClient
    .from('offline_conversion_queue')
    .select('id, sale_id, call_id, gclid, wbraid, gbraid, conversion_time, occurred_at, created_at, updated_at, value_cents, optimization_stage, optimization_value, currency, action, external_id, session_id, provider_key')
    .eq('site_id', ctx.siteUuid)
    .in('status', ['QUEUED', 'RETRY'])
    .eq('provider_key', ctx.providerFilter);
  if (ctx.queueCursorUpdatedAt && ctx.queueCursorId) {
    queueQuery = queueQuery.or(`updated_at.gt.${ctx.queueCursorUpdatedAt},and(updated_at.eq.${ctx.queueCursorUpdatedAt},id.gt.${ctx.queueCursorId})`);
  }
  const { data: queueRows, error: queueError } = await queueQuery
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(queueLimit);
  if (queueError) {
    if (isMissingOciRelationError(queueError)) {
      throw new ExportHttpError(503, {
        error: 'OCI export unavailable: database tables missing or not exposed',
        code: 'OCI_SCHEMA_INCOMPLETE',
        details: supabaseErrorToError('offline_conversion_queue', queueError).message,
      });
    }
    throw supabaseErrorToError('offline_conversion_queue', queueError);
  }

  return {
    rawList: Array.isArray(queueRows) ? (queueRows as QueueRow[]) : [],
  };
}
