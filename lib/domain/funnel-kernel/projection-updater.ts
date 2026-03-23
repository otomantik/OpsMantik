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
 * Industrial Grade: Delegates to PostgreSQL RPC for atomic Read-Calculate-Write.
 */
export async function processCallProjection(callId: string, siteId: string): Promise<void> {
  // Phase Elite: Atomic DB-side reduction eliminates "Lost Update" race conditions.
  const { error } = await adminClient.rpc('rebuild_call_projection', {
    p_call_id: callId,
    p_site_id: siteId,
  });

  if (error) {
    logWarn('processCallProjection RPC failed', { callId, siteId, error: error.message });
    throw error;
  }
}
