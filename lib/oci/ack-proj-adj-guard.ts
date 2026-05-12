/**
 * PR-9J.CI-AUDIT-P1: ACK SUCCESS must fail closed when proj_/adj_ targets are missing
 * or not in the expected pre-update status. Prevents silent "already terminal" inflation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type AckProjAdjGuardFailure = {
  ok: false;
  status: 409;
  body: Record<string, unknown>;
};

export type AckProjAdjGuardSuccess = {
  ok: true;
  projectionRowIds: string[];
  adjustmentIds: string[];
};

/** Pure helper for unit tests: READY rows must cover each requested call_id exactly once. */
export function classifyAckProjectionReadyRows(
  uniqueProjCallIds: string[],
  rows: Array<{ id: string; call_id: string | null }>
): { kind: 'ok'; projectionRowIds: string[] } | { kind: 'missing_or_not_ready' } | { kind: 'ambiguous_duplicate_call_id' } {
  const byCall = new Map<string, string>();
  for (const r of rows) {
    const cid = r.call_id != null ? String(r.call_id) : '';
    if (!cid) continue;
    if (byCall.has(cid)) return { kind: 'ambiguous_duplicate_call_id' };
    byCall.set(cid, r.id);
  }
  if (byCall.size !== uniqueProjCallIds.length) return { kind: 'missing_or_not_ready' };
  const projectionRowIds = uniqueProjCallIds.map((cid) => byCall.get(cid)).filter((v): v is string => typeof v === 'string');
  if (projectionRowIds.length !== uniqueProjCallIds.length) return { kind: 'missing_or_not_ready' };
  return { kind: 'ok', projectionRowIds };
}

export function classifyAckAdjustmentProcessingRows(
  uniqueAdjIds: string[],
  foundIds: ReadonlySet<string>
): 'ok' | 'missing_or_not_processing' {
  if (foundIds.size !== uniqueAdjIds.length) return 'missing_or_not_processing';
  for (const id of uniqueAdjIds) {
    if (!foundIds.has(id)) return 'missing_or_not_processing';
  }
  return 'ok';
}

/**
 * Read-only validation for ACK SUCCESS proj_/adj_ targets; returns row PKs for UPDATE.
 */
export async function resolveAckProjAdjTargetsForSuccess(params: {
  admin: SupabaseClient;
  siteId: string;
  projCallIds: string[];
  adjIds: string[];
}): Promise<AckProjAdjGuardFailure | AckProjAdjGuardSuccess> {
  const uniqueProj = [...new Set(params.projCallIds.filter(Boolean))];
  const uniqueAdj = [...new Set(params.adjIds.filter(Boolean))];

  let projectionRowIds: string[] = [];
  if (uniqueProj.length > 0) {
    const { data: projRows, error: projFetchError } = await params.admin
      .from('call_funnel_projection')
      .select('id, call_id')
      .in('call_id', uniqueProj)
      .eq('site_id', params.siteId)
      .eq('export_status', 'READY');
    if (projFetchError) {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          code: 'ACK_PROJECTION_TARGET_MISMATCH',
          reason_group: 'ACK_PROJECTION_TARGET_MISMATCH',
          target_type: 'projection',
          error: 'fetch_failed',
        },
      };
    }
    const rows = Array.isArray(projRows) ? (projRows as Array<{ id: string; call_id: string | null }>) : [];
    const classified = classifyAckProjectionReadyRows(uniqueProj, rows);
    if (classified.kind !== 'ok') {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          code: 'ACK_PROJECTION_TARGET_MISMATCH',
          reason_group: 'ACK_PROJECTION_TARGET_MISMATCH',
          target_type: 'projection',
          error: classified.kind,
          requested_count: uniqueProj.length,
          ready_row_count: rows.length,
        },
      };
    }
    projectionRowIds = classified.projectionRowIds;
  }

  let adjustmentIdsResolved: string[] = [];
  if (uniqueAdj.length > 0) {
    const { data: adjRows, error: adjFetchError } = await params.admin
      .from('conversion_adjustments')
      .select('id')
      .in('id', uniqueAdj)
      .eq('site_id', params.siteId)
      .eq('status', 'PROCESSING');
    if (adjFetchError) {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          code: 'ACK_ADJUSTMENT_TARGET_MISMATCH',
          reason_group: 'ACK_ADJUSTMENT_TARGET_MISMATCH',
          target_type: 'adjustment',
          error: 'fetch_failed',
        },
      };
    }
    const rows = Array.isArray(adjRows) ? (adjRows as Array<{ id: string | null }>) : [];
    const found = new Set(rows.map((r) => r.id).filter((id): id is string => typeof id === 'string' && id.length > 0));
    const adjClass = classifyAckAdjustmentProcessingRows(uniqueAdj, found);
    if (adjClass !== 'ok') {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          code: 'ACK_ADJUSTMENT_TARGET_MISMATCH',
          reason_group: 'ACK_ADJUSTMENT_TARGET_MISMATCH',
          target_type: 'adjustment',
          error: adjClass,
          requested_count: uniqueAdj.length,
          processing_match_count: found.size,
        },
      };
    }
    adjustmentIdsResolved = [...found];
  }

  return { ok: true, projectionRowIds, adjustmentIds: adjustmentIdsResolved };
}
