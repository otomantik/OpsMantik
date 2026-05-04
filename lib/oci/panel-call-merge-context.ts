import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';

export type PanelCallMergeDbRow = {
  merged_into_call_id?: string | null;
  matched_session_id?: string | null;
  updated_at?: string | null;
  version?: number | null;
};

type PanelCallMergeOverlay = {
  id: string;
  site_id: string;
  merged_into_call_id?: string | null;
  matched_session_id?: string | null;
  updated_at?: string | null;
  version?: number | null;
};

/**
 * RPC `apply_call_*` payloads may omit `merged_into_call_id` even when the row is merged.
 * Overlay authoritative `calls` columns before OCI producer planning.
 */
export function mergePanelReturnedCallDbSnapshot<T extends PanelCallMergeOverlay>(
  call: T,
  row: PanelCallMergeDbRow | null | undefined
): T {
  if (!row) return call;

  const dbMerged =
    row.merged_into_call_id != null && String(row.merged_into_call_id).trim().length > 0
      ? String(row.merged_into_call_id).trim()
      : null;
  const merged_into_call_id =
    dbMerged ?? (call.merged_into_call_id != null && String(call.merged_into_call_id).trim().length > 0
      ? String(call.merged_into_call_id).trim()
      : null);

  const callHasSession = Boolean(call.matched_session_id?.trim());
  const dbSession =
    row.matched_session_id != null && String(row.matched_session_id).trim().length > 0
      ? String(row.matched_session_id).trim()
      : null;
  const matched_session_id = callHasSession
    ? String(call.matched_session_id).trim()
    : dbSession ?? (call.matched_session_id?.trim() ? String(call.matched_session_id).trim() : null);

  const updated_at =
    typeof row.updated_at === 'string' && row.updated_at.trim()
      ? row.updated_at
      : call.updated_at;

  return { ...call, merged_into_call_id, matched_session_id, updated_at };
}

export async function overlayPanelReturnedCallMergeContextFromDb<T extends PanelCallMergeOverlay>(
  call: T
): Promise<T> {
  const { data, error } = await adminClient
    .from('calls')
    .select('merged_into_call_id, matched_session_id, updated_at, version')
    .eq('id', call.id)
    .eq('site_id', call.site_id)
    .maybeSingle();

  if (error) {
    logWarn('panel_stage_merge_context_read_failed', {
      call_id: call.id,
      site_id: call.site_id,
      message: error.message,
    });
    return call;
  }

  const row = data as (PanelCallMergeDbRow & { version?: number | null }) | null;
  if (!row) {
    return call;
  }

  if (
    typeof (call as { version?: unknown }).version === 'number' &&
    Number.isFinite((call as { version: number }).version) &&
    typeof row.version === 'number' &&
    Number.isFinite(row.version) &&
    Math.round((call as { version: number }).version) !== Math.round(row.version)
  ) {
    logWarn('panel_stage_merge_context_version_drift', {
      call_id: call.id,
      site_id: call.site_id,
      rpc_version: Math.round((call as { version: number }).version),
      db_version: Math.round(row.version),
    });
  }

  return mergePanelReturnedCallDbSnapshot(call, {
    merged_into_call_id: row.merged_into_call_id,
    matched_session_id: row.matched_session_id,
    updated_at: row.updated_at,
  });
}
