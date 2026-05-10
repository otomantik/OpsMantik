import { adminClient } from '@/lib/supabase/admin';
import {
  isMissingColumnProjectionError,
  isMissingOciRelationError,
  supabaseErrorToError,
} from '@/lib/oci/format-supabase-error';
import type { QueueRow } from '@/lib/oci/google-ads-export/types';
import { ExportHttpError, type ExportAuthContext } from './export-auth';

const EXPORT_QUEUE_LIMIT = 1000;

/**
 * Progressive SELECT list: full journal projection → drop optional columns on 42703.
 * Order matters: try richest first, then tolerate DBs missing `provider_path` (pre-migration)
 * or `user_identifiers` (legacy schema).
 */
const QUEUE_SELECT_VARIANTS = [
  'id, status, sale_id, call_id, gclid, wbraid, gbraid, user_identifiers, provider_path, conversion_time, occurred_at, created_at, updated_at, value_cents, optimization_stage, optimization_value, currency, action, external_id, session_id, provider_key',
  'id, status, sale_id, call_id, gclid, wbraid, gbraid, user_identifiers, conversion_time, occurred_at, created_at, updated_at, value_cents, optimization_stage, optimization_value, currency, action, external_id, session_id, provider_key',
  'id, status, sale_id, call_id, gclid, wbraid, gbraid, provider_path, conversion_time, occurred_at, created_at, updated_at, value_cents, optimization_stage, optimization_value, currency, action, external_id, session_id, provider_key',
  'id, status, sale_id, call_id, gclid, wbraid, gbraid, conversion_time, occurred_at, created_at, updated_at, value_cents, optimization_stage, optimization_value, currency, action, external_id, session_id, provider_key',
] as const;

/** PR-9H.7C parity: richest variant (alias for static tests). */
const QUEUE_SELECT_WITH_USER_IDENTIFIERS = QUEUE_SELECT_VARIANTS[0];
/** Without `user_identifiers` only (still requests `provider_path` when present). */
const QUEUE_SELECT_WITHOUT_USER_IDENTIFIERS = QUEUE_SELECT_VARIANTS[2];

/**
 * Google Ads offline export reads **only** `offline_conversion_queue` (journal SSOT).
 * Legacy `marketing_signals` is not an upload surface; use pulse/recovery for that table.
 */
export type FetchedExportData = {
  rawList: QueueRow[];
};

export async function fetchExportData(ctx: ExportAuthContext): Promise<FetchedExportData> {
  const queueLimit = Math.min(EXPORT_QUEUE_LIMIT, Math.max(1, ctx.pageLimit));

  async function runQueueSelect(selectList: string) {
    let queueQuery = adminClient
      .from('offline_conversion_queue')
      .select(selectList)
      .eq('site_id', ctx.siteUuid)
      .in('status', ['QUEUED', 'RETRY'])
      .eq('provider_key', ctx.providerFilter);
    if (ctx.canaryMode && ctx.canaryAllowlistIds.length > 0) {
      queueQuery = queueQuery.in('id', ctx.canaryAllowlistIds);
    }
    if (ctx.queueCursorUpdatedAt && ctx.queueCursorId) {
      queueQuery = queueQuery.or(
        `updated_at.gt.${ctx.queueCursorUpdatedAt},and(updated_at.eq.${ctx.queueCursorUpdatedAt},id.gt.${ctx.queueCursorId})`
      );
    }
    return queueQuery.order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(queueLimit);
  }

  let queueRows: unknown[] | null = null;
  let queueError: unknown = null;

  for (const selectList of QUEUE_SELECT_VARIANTS) {
    const result = await runQueueSelect(selectList);
    if (!result.error) {
      queueRows = Array.isArray(result.data) ? result.data : [];
      queueError = null;
      break;
    }
    queueError = result.error;
    if (!isMissingColumnProjectionError(result.error)) {
      break;
    }
  }

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
    rawList: Array.isArray(queueRows) ? (queueRows as unknown as QueueRow[]) : [],
  };
}

export { QUEUE_SELECT_WITH_USER_IDENTIFIERS, QUEUE_SELECT_WITHOUT_USER_IDENTIFIERS, QUEUE_SELECT_VARIANTS };
