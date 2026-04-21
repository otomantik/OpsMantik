import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Canonical marketing_signals `dispatch_status` transitions (Panoptic Phase 2).
 * All app-layer writers should use this instead of ad-hoc `.from('marketing_signals').update(...)`.
 */

export async function applyMarketingSignalDispatchBatch(
  admin: SupabaseClient,
  args: {
    siteId: string;
    signalIds: string[];
    expectStatus: string;
    newStatus: string;
    /** When set (e.g. PROCESSING → SENT), persists `google_sent_at`. */
    googleSentAt?: string | null;
  }
): Promise<number> {
  const { siteId, signalIds, expectStatus, newStatus, googleSentAt } = args;
  if (signalIds.length === 0) return 0;

  const { data, error } = await admin.rpc('apply_marketing_signal_dispatch_batch_v1', {
    p_site_id: siteId,
    p_signal_ids: signalIds,
    p_expect_status: expectStatus,
    p_new_status: newStatus,
    p_google_sent_at: googleSentAt ?? null,
  });

  if (error) throw new Error(error.message);
  return typeof data === 'number' ? data : 0;
}

/** Global maintenance: PROCESSING → PENDING when `updated_at` is older than cutoff. */
export async function rescueStaleMarketingSignalsProcessing(
  admin: SupabaseClient,
  cutoffIso: string
): Promise<number> {
  const { data, error } = await admin.rpc('rescue_marketing_signals_stale_processing_v1', {
    p_cutoff: cutoffIso,
  });
  if (error) throw new Error(error.message);
  return typeof data === 'number' ? data : 0;
}
