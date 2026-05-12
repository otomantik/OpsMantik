/**
 * Load `calls.status` (+ optional `calls.oci_status`) for OCI sendability checks.
 * Some production DBs omit `oci_status`; PostgREST then returns 42703 / PGRST204 and empty `data`.
 */

import { adminClient } from '@/lib/supabase/admin';
import { formatSupabaseClientError, isMissingColumnProjectionError } from '@/lib/oci/format-supabase-error';
import { logWarn } from '@/lib/logging/logger';

function isMissingOciStatusColumnError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? '');
  const msg = String(err.message ?? '').toLowerCase();
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    msg.includes('oci_status') ||
    /\bcolumns?\b.*\bdoes not exist\b/.test(msg)
  );
}

/**
 * L23 — separate transient infra errors (PostgREST 5xx / connection failures)
 * from deterministic "row not found" so callers can pick a retry vs. fail-closed branch.
 *
 * Returned `true` for codes that are typically network/upstream/lock-induced and worth retrying;
 * `false` for explicit "no rows" or schema-level failures handled elsewhere.
 */
export function isTransientCallSendabilityError(
  err: { code?: string; message?: string } | null | undefined
): boolean {
  if (!err) return false;
  const code = String(err.code ?? '').trim();
  const msg = String(err.message ?? '').toLowerCase();
  if (['40001', '40P01', '57014', '55P03', '08000', '08003', '08006', '53300', '53400'].includes(code)) {
    return true;
  }
  if (/^PGRST5\d\d$/.test(code) || code === 'PGRST503') return true;
  if (/\bfetch failed\b|\bnetwork\b|\btimeout\b|\bconnection\b|\beai_again\b|\beconnreset\b/.test(msg)) {
    return true;
  }
  return false;
}

export type CallSendabilityFetch =
  | { kind: 'ok'; status: string | null; oci_status: string | null }
  | { kind: 'not_found' }
  | { kind: 'transient_error'; error: { code?: string; message?: string } }
  | { kind: 'permanent_error'; error: { code?: string; message?: string } };

/**
 * Classified variant of {@link fetchCallSendabilityContext}. Existing callers that
 * only need `{status, oci_status}` (with nulls swallowing all errors) can keep
 * using the original helper; new code should branch on `kind` to decide retry.
 */
export async function fetchCallSendabilityContextClassified(
  callId: string,
  siteId: string
): Promise<CallSendabilityFetch> {
  const primary = await adminClient
    .from('calls')
    .select('status, oci_status')
    .eq('id', callId)
    .eq('site_id', siteId)
    .maybeSingle();

  if (!primary.error) {
    if (!primary.data) return { kind: 'not_found' };
    const row = primary.data as { status?: string | null; oci_status?: string | null };
    return { kind: 'ok', status: row.status ?? null, oci_status: row.oci_status ?? null };
  }

  const err = primary.error as { code?: string; message?: string };
  if (isMissingOciStatusColumnError(err)) {
    const fallback = await adminClient
      .from('calls')
      .select('status')
      .eq('id', callId)
      .eq('site_id', siteId)
      .maybeSingle();
    if (!fallback.error) {
      if (!fallback.data) return { kind: 'not_found' };
      const row = fallback.data as { status?: string | null };
      return { kind: 'ok', status: row.status ?? null, oci_status: null };
    }
    const ferr = fallback.error as { code?: string; message?: string };
    return isTransientCallSendabilityError(ferr)
      ? { kind: 'transient_error', error: ferr }
      : { kind: 'permanent_error', error: ferr };
  }

  return isTransientCallSendabilityError(err)
    ? { kind: 'transient_error', error: err }
    : { kind: 'permanent_error', error: err };
}

export async function fetchCallSendabilityContext(
  callId: string,
  siteId: string
): Promise<{ status: string | null; oci_status: string | null }> {
  const primary = await adminClient
    .from('calls')
    .select('status, oci_status')
    .eq('id', callId)
    .eq('site_id', siteId)
    .maybeSingle();

  if (!primary.error && primary.data) {
    const row = primary.data as { status?: string | null; oci_status?: string | null };
    return { status: row.status ?? null, oci_status: row.oci_status ?? null };
  }

  const e = primary.error as { code?: string; message?: string } | undefined;

  if (!isMissingOciStatusColumnError(e)) {
    logWarn('call_sendability_fetch_failed', { call_id: callId, site_id: siteId, error: e?.message });
    return { status: null, oci_status: null };
  }

  const fallback = await adminClient
    .from('calls')
    .select('status')
    .eq('id', callId)
    .eq('site_id', siteId)
    .maybeSingle();

  if (fallback.error || !fallback.data) {
    logWarn('call_sendability_fetch_failed', {
      call_id: callId,
      site_id: siteId,
      error: fallback.error?.message ?? 'no_row',
    });
    return { status: null, oci_status: null };
  }

  const row = fallback.data as { status?: string | null };
  return { status: row.status ?? null, oci_status: null };
}

/**
 * Batch variant for export script / ACK: same oci_status drift fallback.
 */
export async function fetchCallSendabilityRowsForSite(
  siteId: string,
  callIds: string[]
): Promise<Map<string, { status: string | null; oci_status: string | null }>> {
  const map = new Map<string, { status: string | null; oci_status: string | null }>();
  const unique = [...new Set(callIds.filter(Boolean))];
  if (unique.length === 0) return map;

  const primary = await adminClient
    .from('calls')
    .select('id, status, oci_status')
    .eq('site_id', siteId)
    .in('id', unique);

  if (!primary.error && primary.data) {
    for (const row of primary.data) {
      const r = row as { id: string; status?: string | null; oci_status?: string | null };
      map.set(r.id, { status: r.status ?? null, oci_status: r.oci_status ?? null });
    }
    return map;
  }

  const e = primary.error as { code?: string; message?: string } | undefined;

  if (!isMissingOciStatusColumnError(e)) {
    logWarn('call_sendability_batch_fetch_failed', { site_id: siteId, error: e?.message });
    return map;
  }

  const fallback = await adminClient.from('calls').select('id, status').eq('site_id', siteId).in('id', unique);

  if (fallback.error || !fallback.data) {
    logWarn('call_sendability_batch_fetch_failed', {
      site_id: siteId,
      error: fallback.error?.message ?? 'no_rows',
    });
    return map;
  }

  for (const row of fallback.data) {
    const r = row as { id: string; status?: string | null };
    map.set(r.id, { status: r.status ?? null, oci_status: null });
  }

  return map;
}

/** Queue export needs session + seal timestamps alongside sendability columns. */
export type ExportCallContextRow = {
  id: string;
  matched_session_id: string | null;
  created_at: string | null;
  confirmed_at: string | null;
  status: string | null;
  oci_status: string | null;
  caller_phone_hash_sha256: string | null;
};

const EXPORT_CALL_CONTEXT_PROJECTIONS: readonly string[] = [
  'id, matched_session_id, created_at, confirmed_at, status, oci_status, caller_phone_hash_sha256',
  'id, matched_session_id, created_at, confirmed_at, status, caller_phone_hash_sha256',
  'id, matched_session_id, created_at, confirmed_at, status, oci_status',
  'id, matched_session_id, created_at, confirmed_at, status',
  'id, status, matched_session_id, created_at, confirmed_at',
  'id, status',
];

function normalizeExportCallContextRow(r: Record<string, unknown>): ExportCallContextRow {
  return {
    id: String(r.id),
    matched_session_id: (r.matched_session_id as string | null) ?? null,
    created_at: (r.created_at as string | null) ?? null,
    confirmed_at: (r.confirmed_at as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    oci_status: (r.oci_status as string | null) ?? null,
    caller_phone_hash_sha256: (r.caller_phone_hash_sha256 as string | null) ?? null,
  };
}

/**
 * Narrow fetch for `calls.caller_phone_hash_sha256` only (PR-9H.7C).
 * Supplements wide projections when PostgREST omits a column or wide SELECT fails partway.
 */
export async function fetchCallerPhoneHashesForCallIds(
  siteId: string,
  callIds: string[]
): Promise<Record<string, string>> {
  const unique = [...new Set(callIds.filter(Boolean))];
  if (unique.length === 0) return {};
  const out: Record<string, string> = {};
  const { data, error } = await adminClient
    .from('calls')
    .select('id, caller_phone_hash_sha256')
    .eq('site_id', siteId)
    .in('id', unique);
  if (error) {
    if (isMissingColumnProjectionError(error)) {
      logWarn('export_caller_phone_hash_column_missing', { site_id: siteId });
    } else {
      logWarn('export_caller_phone_hash_fetch_failed', { site_id: siteId, error: formatSupabaseClientError(error) });
    }
    return out;
  }
  if (!data) return out;
  for (const row of data as Array<{ id?: string; caller_phone_hash_sha256?: string | null }>) {
    const id = row.id != null ? String(row.id) : '';
    const h = typeof row.caller_phone_hash_sha256 === 'string' ? row.caller_phone_hash_sha256.trim() : '';
    if (id && h) out[id] = h;
  }
  return out;
}

export async function fetchExportCallContextRows(siteId: string, callIds: string[]): Promise<ExportCallContextRow[]> {
  const unique = [...new Set(callIds.filter(Boolean))];
  if (unique.length === 0) return [];

  let rawRows: Array<Record<string, unknown>> | null = null;
  for (const projection of EXPORT_CALL_CONTEXT_PROJECTIONS) {
    const res = await adminClient.from('calls').select(projection).eq('site_id', siteId).in('id', unique);
    if (!res.error && res.data != null) {
      rawRows = res.data as unknown as Array<Record<string, unknown>>;
      break;
    }
    const err = res.error as { code?: string; message?: string } | undefined;
    const recoverable =
      isMissingOciStatusColumnError(err) ||
      isMissingColumnProjectionError(err);
    if (!recoverable) {
      logWarn('export_call_context_fetch_failed', { site_id: siteId, error: formatSupabaseClientError(res.error) });
      rawRows = [];
      break;
    }
  }
  if (rawRows === null) rawRows = [];

  const rows: ExportCallContextRow[] = rawRows.map((r) => normalizeExportCallContextRow(r));
  const hashMap = await fetchCallerPhoneHashesForCallIds(siteId, unique);
  for (const row of rows) {
    const extra = hashMap[row.id];
    if (!extra) continue;
    const cur = row.caller_phone_hash_sha256 != null ? String(row.caller_phone_hash_sha256).trim() : '';
    if (!cur) row.caller_phone_hash_sha256 = extra;
  }

  return rows;
}
