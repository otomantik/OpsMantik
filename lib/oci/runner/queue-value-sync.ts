/**
 * Runner queue value sync — re-read from `calls` and validate queue value cents
 * against the current optimization snapshot. Returns the set of queue ids that
 * drifted beyond the tolerance window and must be treated as mismatches.
 *
 * Extracted from lib/oci/runner.ts during Phase 4 god-object split.
 */

import { adminClient } from '@/lib/supabase/admin';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';
import type { QueueRow } from '@/lib/cron/process-offline-conversions';

/**
 * PR-VK-6 drift tolerance: small per-row differences (rounding, FX) are expected
 * and must not fail the whole queue row. 100 minor-units (~1 unit of any major
 * currency) is a safe accept-band.
 */
const QUEUE_VALUE_DRIFT_TOLERANCE_CENTS = 100;

export async function syncQueueValuesFromCalls(
  siteIdUuid: string,
  siteRows: QueueRow[],
  prefix: string
): Promise<Set<string>> {
  void siteIdUuid;
  const mismatchIds = new Set<string>();
  const withCallId = siteRows.filter((r) => r.call_id);
  if (withCallId.length === 0) return mismatchIds;

  const callIds = [...new Set(withCallId.map((r) => r.call_id!).filter(Boolean))];
  const { data: callsData } = await adminClient
    .from('calls')
    .select('id, lead_score, sale_amount, currency')
    .in('id', callIds);
  const callsById = new Map(
    (callsData ?? []).map((c: { id: string; lead_score?: number | null; sale_amount?: number | null; currency?: string | null }) => [c.id, c])
  );

  for (const row of withCallId) {
    const call = callsById.get(row.call_id!);
    if (!call) continue;
    const saleAmount =
      call.sale_amount != null && Number.isFinite(Number(call.sale_amount))
        ? Number(call.sale_amount)
        : null;
    const snapshot = buildOptimizationSnapshot({
      stage: 'won',
      systemScore: (call as { lead_score?: number | null }).lead_score ?? null,
      actualRevenue: saleAmount,
    });
    const freshCents = Math.max(Math.round(snapshot.optimizationValue * 100), 1);
    const storedCents =
      typeof row.value_cents === 'number' ? row.value_cents : Number(row.value_cents) ?? 0;

    const diff = Math.abs((freshCents ?? 0) - storedCents);

    if (diff > QUEUE_VALUE_DRIFT_TOLERANCE_CENTS) {
      logWarn('QUEUE_VALUE_MISMATCH', {
        queue_id: row.id,
        call_id: row.call_id,
        stored_cents: storedCents,
        computed_cents: freshCents,
        diff_cents: diff,
        prefix,
      });
      mismatchIds.add(row.id);
    } else if (diff > 0) {
      logInfo('QUEUE_VALUE_DRIFT_ACCEPTED', {
        queue_id: row.id,
        call_id: row.call_id,
        stored_cents: storedCents,
        computed_cents: freshCents,
        diff_cents: diff,
        prefix,
      });
    }
  }

  return mismatchIds;
}
