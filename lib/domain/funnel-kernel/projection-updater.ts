/**
 * Funnel Kernel Projection Updater
 * Deterministic reducer: rebuild projection from ledger events.
 * Order: occurred_at ASC NULLS LAST, ingested_at ASC, created_at ASC, id ASC
 * See: docs/architecture/PROJECTION_REDUCER_SPEC.md
 */

import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import type { PipelineStage } from '@/lib/domain/mizan-mantik/types';

export interface CallFunnelProjection {
  call_id: string;
  site_id: string;
  highest_stage: PipelineStage | null;
  current_stage: string;
  contacted_at: string | null;
  offered_at: string | null;
  won_at: string | null;
  funnel_completeness: 'incomplete' | 'partial' | 'complete';
  export_status: string;
}

export function isMissingRebuildProjectionRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? '').toUpperCase();
  const msg = String(error.message ?? '').toLowerCase();
  return (
    code.startsWith('PGRST') ||
    (msg.includes('rebuild_call_projection') && msg.includes('does not exist')) ||
    (msg.includes('/rpc/rebuild_call_projection') && msg.includes('404'))
  );
}

/**
 * Process a single call's ledger events and upsert projection.
 * Industrial Grade: Delegates to PostgreSQL RPC for atomic Read-Calculate-Write.
 */
export async function processCallProjection(callId: string, siteId: string): Promise<void> {
  // Phase Elite: Atomic DB-side reduction eliminates "Lost Update" race conditions.
  const { error } = await adminClient.rpc('rebuild_call_projection', {
    p_call_id: callId,
    p_site_id: siteId,
  });

  if (error) {
    // Remote projects can temporarily miss this RPC during schema drift.
    // Do not break the caller path; emit structured warning for follow-up migration.
    if (isMissingRebuildProjectionRpc(error as { code?: string; message?: string })) {
      logWarn('processCallProjection RPC missing, skipping projection rebuild', {
        callId,
        siteId,
        error: error.message,
      });
      return;
    }
    logWarn('processCallProjection RPC failed', { callId, siteId, error: error.message });
    throw error;
  }
}
