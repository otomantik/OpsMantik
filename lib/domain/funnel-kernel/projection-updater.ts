/**
 * Funnel Kernel Projection Updater
 * Deterministic reducer: rebuild projection from ledger events.
 * Order: occurred_at ASC NULLS LAST, ingested_at ASC, created_at ASC, id ASC
 * See: docs/architecture/PROJECTION_REDUCER_SPEC.md
 */

import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';

export type ProjectionStage = 'V2' | 'V3' | 'V4' | 'V5';

export interface CallFunnelProjection {
  call_id: string;
  site_id: string;
  highest_stage: ProjectionStage;
  current_stage: string;
  v2_at: string | null;
  v3_at: string | null;
  v4_at: string | null;
  v5_at: string | null;
  v2_source: 'REAL' | 'SYNTHETIC' | null;
  funnel_completeness: 'incomplete' | 'partial' | 'complete';
  export_status: string;
}

/**
 * Process a single call's ledger events and upsert projection.
 * Skeleton: fetches events, reduces to projection row, upserts.
 */
export async function processCallProjection(callId: string, siteId: string): Promise<void> {
  const { data: events, error: fetchErr } = await adminClient
    .from('call_funnel_ledger')
    .select('*')
    .eq('call_id', callId)
    .eq('site_id', siteId)
    .order('occurred_at', { ascending: true })
    .order('ingested_at', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (fetchErr) {
    logWarn('processCallProjection fetch failed', { callId, siteId, error: fetchErr.message });
    throw fetchErr;
  }

  if (!events || events.length === 0) {
    return;
  }

  const projection = reduceEventsToProjection(events);
  if (!projection) return;

  const { error: upsertErr } = await adminClient.from('call_funnel_projection').upsert(
    {
      ...projection,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'call_id' }
  );

  if (upsertErr) {
    logWarn('processCallProjection upsert failed', { callId, siteId, error: upsertErr.message });
    throw upsertErr;
  }

  // Phase 13: Funnel invariant enforcement — log violations (e.g. V5 without V2)
  const violations = checkFunnelInvariants(projection);
  for (const v of violations) {
    try {
      const { error } = await adminClient.from('funnel_invariant_violations').insert({
        site_id: siteId,
        call_id: callId,
        violation_code: v.code,
        details_json: v.details,
      });
      if (error) {
        // 23505 = unique_violation (duplicate open violation) — suppress
        if (error.code !== '23505') logWarn('funnel_invariant_insert_failed', { callId, siteId, code: v.code, error: error.message });
      }
    } catch (e) {
      logWarn('funnel_invariant_insert_failed', { callId, siteId, code: v.code, error: (e as Error)?.message });
    }
  }
}

function checkFunnelInvariants(proj: Partial<CallFunnelProjection>): { code: string; details: Record<string, unknown> }[] {
  const violations: { code: string; details: Record<string, unknown> }[] = [];
  const v5 = proj.v5_at != null;
  const v4 = proj.v4_at != null;
  const v3 = proj.v3_at != null;
  const v2 = proj.v2_at != null;

  if (v5 && !v2) violations.push({ code: 'V5_WITHOUT_V2', details: { v5_at: proj.v5_at, v2_at: proj.v2_at } });
  if (v5 && !v3) violations.push({ code: 'V5_WITHOUT_V3', details: { v5_at: proj.v5_at, v3_at: proj.v3_at } });
  if (v5 && !v4) violations.push({ code: 'V5_WITHOUT_V4', details: { v5_at: proj.v5_at, v4_at: proj.v4_at } });
  if (v4 && !v3) violations.push({ code: 'V4_WITHOUT_V3', details: { v4_at: proj.v4_at, v3_at: proj.v3_at } });
  if (v3 && !v2) violations.push({ code: 'V3_WITHOUT_V2', details: { v3_at: proj.v3_at, v2_at: proj.v2_at } });

  return violations;
}

/**
 * Reduce ordered ledger events to a projection row.
 * Deterministic: same events → same projection.
 */
function reduceEventsToProjection(events: Record<string, unknown>[]): Partial<CallFunnelProjection> | null {
  const first = events[0] as Record<string, unknown> | undefined;
  if (!first || !first.call_id || !first.site_id) return null;

  let highest: ProjectionStage = 'V2';
  let v2_at: string | null = null;
  let v3_at: string | null = null;
  let v4_at: string | null = null;
  let v5_at: string | null = null;
  let v2_source: 'REAL' | 'SYNTHETIC' | null = null;

  for (const ev of events) {
    const type = ev.event_type as string;
    const occurred = ev.occurred_at as string;
    if (type === 'V2_CONTACT' || type === 'V2_SYNTHETIC') {
      v2_at = occurred;
      v2_source = type === 'V2_SYNTHETIC' ? 'SYNTHETIC' : 'REAL';
      if (highest === 'V2') highest = 'V2';
    }
    if (type === 'V3_QUALIFIED') {
      v3_at = occurred;
      if (['V2', 'V3'].includes(highest)) highest = 'V3';
    }
    if (type === 'V4_INTENT') {
      v4_at = occurred;
      if (['V2', 'V3', 'V4'].includes(highest)) highest = 'V4';
    }
    if (type === 'V5_SEALED') {
      v5_at = occurred;
      highest = 'V5';
    }
  }

  let value_cents: number | null = null;
  let currency: string | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i] as Record<string, unknown>;
    if ((ev.event_type as string) === 'V5_SEALED') {
      const p = ev.payload as { value_cents?: number; currency?: string } | undefined;
      if (p?.value_cents != null && Number.isFinite(p.value_cents)) value_cents = Math.round(p.value_cents);
      if (p?.currency && typeof p.currency === 'string') currency = String(p.currency).trim() || null;
      break;
    }
  }

  const funnel_completeness =
    v5_at && v2_at && v3_at && v4_at ? 'complete' : v2_at ? 'partial' : 'incomplete';
  const export_status = funnel_completeness === 'complete' ? 'READY' : 'NOT_READY';

  return {
    call_id: first.call_id as string,
    site_id: first.site_id as string,
    highest_stage: highest,
    current_stage: v5_at ? 'V5' : 'V2',
    v2_at,
    v3_at,
    v4_at,
    v5_at,
    v2_source,
    funnel_completeness,
    export_status,
    ...(value_cents != null && { value_cents }),
    ...(currency != null && { currency }),
  };
}
