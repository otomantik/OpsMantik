import { adminClient } from '@/lib/supabase/admin';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { logWarn } from '@/lib/logging/logger';

export async function recordTruthParityMismatch(input: {
  siteId: string;
  streamKind: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  error: string;
}): Promise<void> {
  const mismatchKey = `${input.siteId}:${input.streamKind}:${input.idempotencyKey}`;
  const { data, error } = await adminClient
    .from('truth_parity_mismatches')
    .upsert(
      {
        mismatch_key: mismatchKey,
        site_id: input.siteId,
        stream_kind: input.streamKind,
        idempotency_key: input.idempotencyKey,
        payload: input.payload,
        status: 'OPEN',
        last_error: input.error.slice(0, 500),
      },
      { onConflict: 'mismatch_key' }
    )
    .select('id')
    .maybeSingle();
  if (error) {
    logWarn('truth_parity_mismatch_insert_failed', {
      site_id: input.siteId,
      stream_kind: input.streamKind,
      idempotency_key: input.idempotencyKey,
      error: error.message,
    });
    return;
  }

  incrementRefactorMetric('truth_parity_mismatch_total');
  if (!data?.id) return;

  const dedupKey = `repair:${mismatchKey}`;
  await adminClient
    .from('truth_parity_repair_queue')
    .upsert(
      {
        mismatch_id: data.id,
        dedup_key: dedupKey,
        status: 'PENDING',
      },
      { onConflict: 'dedup_key' }
    );
  incrementRefactorMetric('truth_repair_backlog');
}
