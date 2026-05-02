import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import { getDbNowIso } from '@/lib/time/db-now';

export type WatchdogSnapshot = {
  outboxProcessingOlderThanSla: number;
  queueProcessingOlderThanSla: number;
  dedupProcessingOlderThanSla: number;
  generatedAt: string;
};

export async function collectLivenessWatchdogSnapshot(): Promise<WatchdogSnapshot> {
  const nowIso = await getDbNowIso();
  const thirtyOneMinutesAgo = new Date(new Date(nowIso).getTime() - 31 * 60 * 1000).toISOString();

  const [outbox, queue, dedup] = await Promise.all([
    adminClient
      .from('outbox_events')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PROCESSING')
      .or(`processing_started_at.lt.${thirtyOneMinutesAgo},and(processing_started_at.is.null,updated_at.lt.${thirtyOneMinutesAgo})`),
    adminClient
      .from('offline_conversion_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PROCESSING')
      .lt('updated_at', thirtyOneMinutesAgo),
    adminClient
      .from('processed_signals')
      .select('event_id', { count: 'exact', head: true })
      .eq('status', 'processing')
      .lt('created_at', thirtyOneMinutesAgo),
  ]);

  return {
    outboxProcessingOlderThanSla: outbox.count ?? 0,
    queueProcessingOlderThanSla: queue.count ?? 0,
    dedupProcessingOlderThanSla: dedup.count ?? 0,
    generatedAt: nowIso,
  };
}

export async function enforceLivenessWatchdogs(): Promise<void> {
  const snap = await collectLivenessWatchdogSnapshot();
  if (
    snap.outboxProcessingOlderThanSla > 0 ||
    snap.queueProcessingOlderThanSla > 0 ||
    snap.dedupProcessingOlderThanSla > 0
  ) {
    logWarn('OCI_LIVENESS_WATCHDOG_BREACH', snap);
  }
}

export function isZeroLeakSnapshot(snapshot: WatchdogSnapshot): boolean {
  return (
    snapshot.outboxProcessingOlderThanSla === 0 &&
    snapshot.queueProcessingOlderThanSla === 0 &&
    snapshot.dedupProcessingOlderThanSla === 0
  );
}
