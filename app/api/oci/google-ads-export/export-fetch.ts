import { adminClient } from '@/lib/supabase/admin';
import { isMissingOciRelationError, supabaseErrorToError } from '@/lib/oci/format-supabase-error';
import type { QueueRow } from '@/lib/oci/google-ads-export/types';
import {
  parseJitExportRpcRowsStrict,
  type JitExportRpcRow,
} from '@/lib/oci/validation/google-ads-hashed-identifiers.zod';
import { ExportHttpError, type ExportAuthContext } from './export-auth';

const EXPORT_QUEUE_LIMIT = 1000;

/**
 * Legacy journal column projection (tooling / audits). Runtime export uses
 * `fetch_oci_google_ads_export_jit_v1` — one atomic query with calls + sessions + consent gate.
 */
export const QUEUE_SELECT_VARIANTS = [
  'id, status, sale_id, call_id, gclid, wbraid, gbraid, user_identifiers, provider_path, conversion_time, occurred_at, created_at, updated_at, value_cents, optimization_stage, optimization_value, currency, action, external_id, session_id, provider_key',
  'id, status, sale_id, call_id, gclid, wbraid, gbraid, user_identifiers, conversion_time, occurred_at, created_at, updated_at, value_cents, optimization_stage, optimization_value, currency, action, external_id, session_id, provider_key',
  'id, status, sale_id, call_id, gclid, wbraid, gbraid, provider_path, conversion_time, occurred_at, created_at, updated_at, value_cents, optimization_stage, optimization_value, currency, action, external_id, session_id, provider_key',
  'id, status, sale_id, call_id, gclid, wbraid, gbraid, conversion_time, occurred_at, created_at, updated_at, value_cents, optimization_stage, optimization_value, currency, action, external_id, session_id, provider_key',
] as const;

export const QUEUE_SELECT_WITH_USER_IDENTIFIERS = QUEUE_SELECT_VARIANTS[0];
export const QUEUE_SELECT_WITHOUT_USER_IDENTIFIERS = QUEUE_SELECT_VARIANTS[2];

export type FetchedExportData = {
  rawList: QueueRow[];
};

function mapJitRpcRowToQueueRow(r: JitExportRpcRow): QueueRow {
  return {
    id: r.id,
    status: r.status ?? undefined,
    sale_id: r.sale_id,
    call_id: r.call_id,
    session_id: r.session_id,
    gclid: r.gclid,
    wbraid: r.wbraid,
    gbraid: r.gbraid,
    user_identifiers: r.user_identifiers,
    provider_path: r.provider_path,
    conversion_time: r.conversion_time,
    occurred_at: r.occurred_at ?? undefined,
    created_at: r.created_at ?? undefined,
    updated_at: r.updated_at ?? undefined,
    value_cents: r.value_cents,
    optimization_stage: r.optimization_stage ?? undefined,
    optimization_value: r.optimization_value ?? undefined,
    currency: r.currency ?? undefined,
    action: r.action ?? undefined,
    external_id: r.external_id,
    provider_key: r.provider_key ?? undefined,
    jit_call_status: r.jit_call_status ?? undefined,
    jit_call_oci_status: r.jit_call_oci_status ?? undefined,
    jit_call_matched_session_id: r.jit_call_matched_session_id ?? undefined,
    jit_call_created_at: r.jit_call_created_at ?? undefined,
    jit_call_confirmed_at: r.jit_call_confirmed_at ?? undefined,
    jit_caller_phone_hash_sha256: r.jit_caller_phone_hash_sha256 ?? undefined,
  };
}

/**
 * Atomic JIT export slice: single RPC joins queue + calls + sessions; marketing consent gates hashes in SQL.
 */
export async function fetchExportData(ctx: ExportAuthContext): Promise<FetchedExportData> {
  const queueLimit = Math.min(EXPORT_QUEUE_LIMIT, Math.max(1, ctx.pageLimit));

  const { data, error } = await adminClient.rpc('fetch_oci_google_ads_export_jit_v1', {
    p_site_id: ctx.siteUuid,
    p_provider_key: ctx.providerFilter,
    p_limit: queueLimit,
    p_cursor_updated_at: ctx.queueCursorUpdatedAt || null,
    p_cursor_id: ctx.queueCursorId || null,
    p_canary_queue_ids:
      ctx.canaryMode && ctx.canaryAllowlistIds.length > 0 ? ctx.canaryAllowlistIds : null,
  });

  if (error) {
    const code = (error as { code?: string }).code;
    const msg = supabaseErrorToError('fetch_oci_google_ads_export_jit_v1', error).message;
    if (
      code === '42883' ||
      /fetch_oci_google_ads_export_jit_v1|does not exist|undefined_function/i.test(error.message || '')
    ) {
      throw new ExportHttpError(503, {
        error: 'OCI export JIT RPC missing or outdated — apply migration 20261229130000_fetch_oci_google_ads_export_jit_v1',
        code: 'OCI_EXPORT_JIT_RPC_MISSING',
        details: msg,
      });
    }
    if (isMissingOciRelationError(error)) {
      throw new ExportHttpError(503, {
        error: 'OCI export unavailable: database tables missing or not exposed',
        code: 'OCI_SCHEMA_INCOMPLETE',
        details: msg,
      });
    }
    throw supabaseErrorToError('fetch_oci_google_ads_export_jit_v1', error);
  }

  try {
    const parsed = parseJitExportRpcRowsStrict(data ?? []);
    return { rawList: parsed.map(mapJitRpcRowToQueueRow) };
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e);
    throw new ExportHttpError(500, {
      error: 'OCI export JIT row validation failed',
      code: 'OCI_EXPORT_JIT_ZOD_REJECT',
      details,
    });
  }
}
