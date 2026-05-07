import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Queue-only retirement shim.
 * Legacy signal dispatch mutations are retired and intentionally no-op.
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
  void admin;
  void args;
  return 0;
}

/** Queue-only retirement shim. */
export async function rescueStaleMarketingSignalsProcessing(
  admin: SupabaseClient,
  cutoffIso: string
): Promise<number> {
  void admin;
  void cutoffIso;
  return 0;
}
