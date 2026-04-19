/**
 * Phase 20: Shared gear helpers (V2 dedup, shadow log, etc.)
 */

import { adminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging/logger';

export function logShadowDecision(
  siteId: string,
  aggregateType: 'conversion' | 'signal' | 'pv',
  aggregateId: string | null,
  rejectedBranch: string,
  reason: string,
  context: Record<string, unknown> = {}
): void {
  void adminClient
    .rpc('insert_shadow_decision', {
      p_site_id: siteId,
      p_aggregate_type: aggregateType,
      p_aggregate_id: aggregateId,
      p_rejected_gear_or_branch: rejectedBranch,
      p_reason: reason,
      p_context: context,
    })
    .then(() => {}, () => {});
}

/**
 * Non-blocking causal DNA ledger write with DLQ fallback.
 *
 * Replaces all bare `.then(() => {}, () => {})` fire-and-forget patterns.
 * On RPC failure the failure is logged via `logError` AND inserted into
 * `causal_dna_ledger_failures` for offline reconciliation.
 */
export function appendCausalDnaLedgerSafe(
  siteId: string,
  aggregateType: 'conversion' | 'signal' | 'pv',
  aggregateId: string | null,
  causalDna: unknown
): void {
  void adminClient
    .rpc('append_causal_dna_ledger', {
      p_site_id: siteId,
      p_aggregate_type: aggregateType,
      p_aggregate_id: aggregateId,
      p_causal_dna: causalDna,
    })
    .then(
      () => {},
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logError('CAUSAL_DNA_LEDGER_FAILED', { site_id: siteId, aggregate_type: aggregateType, aggregate_id: aggregateId, error: msg });
        void adminClient.from('causal_dna_ledger_failures').insert({
          site_id: siteId,
          aggregate_type: aggregateType,
          aggregate_id: aggregateId,
          causal_dna: causalDna,
          error_message: msg.slice(0, 2000),
        }).then(() => {}, () => {});
      }
    );
}
