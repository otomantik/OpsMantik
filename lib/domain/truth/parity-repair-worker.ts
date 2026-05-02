import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { isPostgrestRelationUnavailableError } from '@/lib/supabase/postgrest-relation-unavailable';

type RepairRow = {
  id: string;
  mismatch_id: string;
  attempt_count: number;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'DEAD_LETTER';
  updated_at: string;
  truth_parity_mismatches: Array<{
    id: string;
    site_id: string;
    stream_kind: string;
    idempotency_key: string;
    payload: Record<string, unknown>;
  }>;
};

const REPAIR_MAX_ATTEMPTS = 10;
const STALE_PROCESSING_MS = 10 * 60 * 1000;

async function reclaimStaleProcessingRows(limit: number): Promise<void> {
  const cutoffIso = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data: staleRows, error } = await adminClient
    .from('truth_parity_repair_queue')
    .select('id,mismatch_id,attempt_count')
    .eq('status', 'PROCESSING')
    .lt('updated_at', cutoffIso)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error || !Array.isArray(staleRows) || staleRows.length === 0) return;

  for (const row of staleRows as Array<{ id: string; mismatch_id: string; attempt_count: number }>) {
    const attempts = (row.attempt_count ?? 0) + 1;
    const dead = attempts >= REPAIR_MAX_ATTEMPTS;
    const update = await adminClient
      .from('truth_parity_repair_queue')
      .update({
        status: dead ? 'DEAD_LETTER' : 'PENDING',
        attempt_count: attempts,
        next_retry_at: new Date(Date.now() + Math.min(60_000 * attempts, 30 * 60_000)).toISOString(),
        updated_at: new Date().toISOString(),
        last_error: 'stale_processing_reclaimed',
      })
      .eq('id', row.id)
      .eq('status', 'PROCESSING')
      .select('id')
      .maybeSingle();
    if (update.error || !update.data?.id) continue;
    incrementRefactorMetric('truth_repair_reclaim_total');
    if (!dead) continue;
    incrementRefactorMetric('truth_repair_dead_letter_total');
    await adminClient
      .from('truth_parity_mismatches')
      .update({ status: 'DEAD_LETTER', last_error: 'repair_retries_exhausted' })
      .eq('id', row.mismatch_id);
  }
}

export async function runTruthParityRepairBatch(limit = 50): Promise<{
  claimed: number;
  repaired: number;
  failed: number;
}> {
  await reclaimStaleProcessingRows(limit);
  const now = new Date().toISOString();
  const { data, error } = await adminClient
    .from('truth_parity_repair_queue')
    .select('id,mismatch_id,attempt_count,status,updated_at,truth_parity_mismatches!inner(id,site_id,stream_kind,idempotency_key,payload)')
    .eq('status', 'PENDING')
    .lte('next_retry_at', now)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error || !Array.isArray(data) || data.length === 0) {
    return { claimed: 0, repaired: 0, failed: 0 };
  }

  let repaired = 0;
  let failed = 0;

  for (const row of data as RepairRow[]) {
    try {
      const mismatch = Array.isArray(row.truth_parity_mismatches)
        ? row.truth_parity_mismatches[0] ?? null
        : null;
      if (!mismatch) continue;
      const updateClaim = await adminClient
        .from('truth_parity_repair_queue')
        .update({ status: 'PROCESSING', updated_at: now })
        .eq('id', row.id)
        .eq('status', 'PENDING')
        .select('id')
        .maybeSingle();
      if (updateClaim.error || !updateClaim.data?.id) continue;

      const insert = await adminClient.from('truth_canonical_ledger').insert({
        site_id: mismatch.site_id,
        stream_kind: mismatch.stream_kind,
        idempotency_key: mismatch.idempotency_key,
        occurred_at: new Date().toISOString(),
        payload: mismatch.payload,
        schema_version: 'canonical_v1',
      });
      if (insert.error && insert.error.code !== '23505') {
        if (isPostgrestRelationUnavailableError(insert.error, 'truth_canonical_ledger')) {
          await adminClient
            .from('truth_parity_repair_queue')
            .update({
              status: 'PENDING',
              last_error: 'canonical_ledger_unavailable',
              next_retry_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          logWarn('truth_parity_repair_deferred', { queue_id: row.id, reason: 'truth_canonical_ledger_unavailable' });
          failed += 1;
          continue;
        }
        throw insert.error;
      }

      await adminClient
        .from('truth_parity_repair_queue')
        .update({ status: 'DONE', updated_at: new Date().toISOString() })
        .eq('id', row.id);
      await adminClient
        .from('truth_parity_mismatches')
        .update({ status: 'REPAIRED', repaired_at: new Date().toISOString() })
        .eq('id', row.mismatch_id);
      incrementRefactorMetric('truth_repair_success_total');
      repaired += 1;
    } catch (errorRepair) {
      failed += 1;
      const attempts = row.attempt_count + 1;
      const dead = attempts >= REPAIR_MAX_ATTEMPTS;
      await adminClient
        .from('truth_parity_repair_queue')
        .update({
          status: dead ? 'DEAD_LETTER' : 'PENDING',
          attempt_count: attempts,
          next_retry_at: new Date(Date.now() + Math.min(60_000 * attempts, 30 * 60_000)).toISOString(),
          updated_at: new Date().toISOString(),
          last_error: errorRepair instanceof Error ? errorRepair.message.slice(0, 500) : String(errorRepair).slice(0, 500),
        })
        .eq('id', row.id);
      if (dead) {
        incrementRefactorMetric('truth_repair_dead_letter_total');
        await adminClient
          .from('truth_parity_mismatches')
          .update({ status: 'DEAD_LETTER', last_error: 'repair_retries_exhausted' })
          .eq('id', row.mismatch_id);
      }
      logWarn('truth_parity_repair_failed', {
        queue_id: row.id,
        mismatch_id: row.mismatch_id,
        error: errorRepair instanceof Error ? errorRepair.message : String(errorRepair),
      });
    }
  }

  return { claimed: data.length, repaired, failed };
}
