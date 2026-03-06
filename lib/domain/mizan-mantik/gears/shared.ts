/**
 * Phase 20: Shared gear helpers (V2 dedup, shadow log, etc.)
 */

import { adminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging/logger';

const V2_DEDUP_HOURS = 24;

export async function hasRecentV2Pulse(
  siteId: string,
  callId?: string | null,
  gclid?: string | null
): Promise<boolean> {
  if (!callId && !gclid) return false;
  const cutoff = new Date(Date.now() - V2_DEDUP_HOURS * 60 * 60 * 1000).toISOString();

  if (callId) {
    const { data } = await adminClient
      .from('marketing_signals')
      .select('id')
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .eq('signal_type', 'INTENT_CAPTURED')
      .gte('created_at', cutoff)
      .limit(1);
    if (data && data.length > 0) return true;
  }

  if (gclid) {
    const { data: sessions } = await adminClient
      .from('sessions')
      .select('id')
      .eq('site_id', siteId)
      .eq('gclid', gclid)
      .limit(50);
    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map((s: { id: string }) => s.id);
      const { data: calls } = await adminClient
        .from('calls')
        .select('id')
        .eq('site_id', siteId)
        .in('matched_session_id', sessionIds)
        .limit(50);
      if (calls && calls.length > 0) {
        const callIds = calls.map((c: { id: string }) => c.id);
        const { data: signals } = await adminClient
          .from('marketing_signals')
          .select('id')
          .eq('site_id', siteId)
          .in('call_id', callIds)
          .eq('signal_type', 'INTENT_CAPTURED')
          .gte('created_at', cutoff)
          .limit(1);
        if (signals && signals.length > 0) return true;
      }
    }
  }
  return false;
}

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
