/**
 * Load `calls.status` (+ optional `calls.oci_status`) for OCI sendability checks.
 * Some production DBs omit `oci_status`; PostgREST then returns 42703 / PGRST204 and empty `data`.
 */

import { adminClient } from '@/lib/supabase/admin';
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
  confirmed_at: string | null;
  status: string | null;
  oci_status: string | null;
};

export async function fetchExportCallContextRows(siteId: string, callIds: string[]): Promise<ExportCallContextRow[]> {
  const unique = [...new Set(callIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const projection = 'id, matched_session_id, confirmed_at, status, oci_status';
  const primary = await adminClient
    .from('calls')
    .select(projection)
    .eq('site_id', siteId)
    .in('id', unique);

  const toRows = (rows: unknown[]): ExportCallContextRow[] =>
    (rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      matched_session_id: (r.matched_session_id as string | null) ?? null,
      confirmed_at: (r.confirmed_at as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      oci_status: (r.oci_status as string | null) ?? null,
    }));

  if (!primary.error && primary.data) {
    return toRows(primary.data);
  }

  if (!isMissingOciStatusColumnError(primary.error as { code?: string; message?: string })) {
    logWarn('export_call_context_fetch_failed', { site_id: siteId, error: (primary.error as { message?: string })?.message });
    return [];
  }

  const fallback = await adminClient
    .from('calls')
    .select('id, matched_session_id, confirmed_at, status')
    .eq('site_id', siteId)
    .in('id', unique);

  if (fallback.error || !fallback.data) {
    logWarn('export_call_context_fetch_failed', {
      site_id: siteId,
      error: fallback.error?.message ?? 'no_rows',
    });
    return [];
  }

  return (fallback.data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    matched_session_id: (r.matched_session_id as string | null) ?? null,
    confirmed_at: (r.confirmed_at as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    oci_status: null,
  }));
}
