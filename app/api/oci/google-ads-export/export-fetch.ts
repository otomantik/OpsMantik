import { adminClient } from '@/lib/supabase/admin';
import type { QueueRow } from '@/lib/oci/google-ads-export/types';
import type { ExportAuthContext } from './export-auth';

const EXPORT_QUEUE_LIMIT = 1000;
const EXPORT_SIGNALS_LIMIT = 1000;

export type FetchedExportData = {
  rawList: QueueRow[];
  signalList: Array<Record<string, unknown>>;
};

export async function fetchExportData(ctx: ExportAuthContext): Promise<FetchedExportData> {
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
    .limit(EXPORT_QUEUE_LIMIT);
  if (queueError) throw queueError;

  let signalQuery = adminClient
    .from('marketing_signals')
    .select('id, call_id, signal_type, optimization_stage, google_conversion_name, google_conversion_time, occurred_at, conversion_value, optimization_value, gclid, wbraid, gbraid, trace_id, created_at')
    .eq('site_id', ctx.siteUuid)
    .eq('dispatch_status', 'PENDING');
  if (ctx.signalCursorUpdatedAt && ctx.signalCursorId) {
    signalQuery = signalQuery.or(`created_at.gt.${ctx.signalCursorUpdatedAt},and(created_at.eq.${ctx.signalCursorUpdatedAt},id.gt.${ctx.signalCursorId})`);
  }
  const { data: signalRows, error: signalError } = await signalQuery
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(EXPORT_SIGNALS_LIMIT);
  if (signalError) throw signalError;

  return {
    rawList: Array.isArray(queueRows) ? (queueRows as QueueRow[]) : [],
    signalList: Array.isArray(signalRows) ? (signalRows as Array<Record<string, unknown>>) : [],
  };
}
