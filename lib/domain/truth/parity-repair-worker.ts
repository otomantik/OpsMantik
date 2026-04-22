import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

type RepairRow = {
  id: string;
  mismatch_id: string;
  attempt_count: number;
  truth_parity_mismatches: Array<{
    id: string;
    site_id: string;
    stream_kind: string;
    idempotency_key: string;
    payload: Record<string, unknown>;
  }>;
};

export async function runTruthParityRepairBatch(limit = 50): Promise<{
  claimed: number;
  repaired: number;
  failed: number;
}> {
  const now = new Date().toISOString();
  const { data, error } = await adminClient
    .from('truth_parity_repair_queue')
    .select('id,mismatch_id,attempt_count,truth_parity_mismatches!inner(id,site_id,stream_kind,idempotency_key,payload)')
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
        .eq('status', 'PENDING');
      if (updateClaim.error) continue;

      const insert = await adminClient.from('truth_canonical_ledger').insert({
        site_id: mismatch.site_id,
        stream_kind: mismatch.stream_kind,
        idempotency_key: mismatch.idempotency_key,
        occurred_at: new Date().toISOString(),
        payload: mismatch.payload,
        schema_version: 'canonical_v1',
      });
      if (insert.error && insert.error.code !== '23505') {
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
      const dead = attempts >= 10;
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
