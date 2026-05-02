/**
 * Aggregates for BLOCKED_PRECEDING_SIGNALS rows (site scope) — used by queue-stats.
 */

import { adminClient } from '@/lib/supabase/admin';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/domain/mizan-mantik/conversion-names';

const BLOCKING_DISPATCH = new Set([
  'PENDING',
  'PROCESSING',
  'STALLED_FOR_HUMAN_AUDIT',
]);

const PRECURSOR_NAMES = [
  OPSMANTIK_CONVERSION_NAMES.contacted,
  OPSMANTIK_CONVERSION_NAMES.offered,
];

const PROMOTION_SCAN_CAP = 500;

export interface BlockedQueueMetrics {
  blockReasonBreakdown: Record<string, number>;
  /** Earliest blocked_at among blocked rows (ISO). */
  oldestBlockedAtIso: string | null;
  oldestBlockedAgeSeconds: number | null;
  /** Among first PROMOTION_SCAN_CAP blocked rows: how many are ready to promote (precursors non-blocking). */
  promotionReadyInSample: number;
  blockedSampleSize: number;
  promotionScanCapped: boolean;
}

export async function computeBlockedQueueMetrics(siteUuid: string): Promise<BlockedQueueMetrics> {
  const { count: blockedTotal } = await adminClient
    .from('offline_conversion_queue')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteUuid)
    .eq('status', 'BLOCKED_PRECEDING_SIGNALS');

  const totalBlocked = typeof blockedTotal === 'number' ? blockedTotal : 0;

  const { data: reasonRows } = await adminClient
    .from('offline_conversion_queue')
    .select('block_reason')
    .eq('site_id', siteUuid)
    .eq('status', 'BLOCKED_PRECEDING_SIGNALS');

  const blockReasonBreakdown: Record<string, number> = {};
  for (const r of Array.isArray(reasonRows) ? reasonRows : []) {
    const key = (r as { block_reason?: string | null }).block_reason ?? '(null)';
    blockReasonBreakdown[key] = (blockReasonBreakdown[key] ?? 0) + 1;
  }

  const { data: oldest } = await adminClient
    .from('offline_conversion_queue')
    .select('blocked_at')
    .eq('site_id', siteUuid)
    .eq('status', 'BLOCKED_PRECEDING_SIGNALS')
    .not('blocked_at', 'is', null)
    .order('blocked_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const oldestAt = (oldest as { blocked_at?: string } | null)?.blocked_at ?? null;
  const oldestBlockedAgeSeconds =
    oldestAt != null
      ? Math.max(0, Math.floor((Date.now() - new Date(oldestAt).getTime()) / 1000))
      : null;

  const { data: blockedSample } = await adminClient
    .from('offline_conversion_queue')
    .select('call_id')
    .eq('site_id', siteUuid)
    .eq('status', 'BLOCKED_PRECEDING_SIGNALS')
    .not('call_id', 'is', null)
    .order('blocked_at', { ascending: true })
    .limit(PROMOTION_SCAN_CAP);

  const sample = Array.isArray(blockedSample) ? blockedSample : [];
  const callIds = [...new Set(sample.map((r) => (r as { call_id: string }).call_id).filter(Boolean))];

  let promotionReadyInSample = 0;
  if (callIds.length > 0) {
    const { data: sigRows } = await adminClient
      .from('marketing_signals')
      .select('call_id, dispatch_status')
      .eq('site_id', siteUuid)
      .in('call_id', callIds)
      .in('google_conversion_name', PRECURSOR_NAMES);

    const blockingByCall = new Map<string, boolean>();
    for (const row of Array.isArray(sigRows) ? sigRows : []) {
      const cid = (row as { call_id: string }).call_id;
      const st = String((row as { dispatch_status?: string }).dispatch_status ?? '');
      if (BLOCKING_DISPATCH.has(st)) {
        blockingByCall.set(cid, true);
      }
    }

    for (const r of sample) {
      const cid = (r as { call_id: string }).call_id;
      if (!cid) continue;
      if (!blockingByCall.get(cid)) {
        promotionReadyInSample++;
      }
    }
  }

  return {
    blockReasonBreakdown,
    oldestBlockedAtIso: oldestAt,
    oldestBlockedAgeSeconds,
    promotionReadyInSample,
    blockedSampleSize: sample.length,
    promotionScanCapped: totalBlocked > PROMOTION_SCAN_CAP,
  };
}
