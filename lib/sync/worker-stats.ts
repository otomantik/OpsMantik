/**
 * Best-effort Redis-backed stats for the sync worker.
 * Failures are logged (REDIS_STATS_DEGRADED) and must not fail the job or grow DLQ.
 */
import { StatsService } from '@/lib/services/stats-service';
import { logWarn } from '@/lib/logging/logger';

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

/**
 * Best-effort stats increment. Redis failure must not fail the job (no DLQ for stats-only errors).
 * Logs REDIS_STATS_DEGRADED and continues.
 */
export async function incrementCapturedSafe(siteId: string, hasGclid: boolean): Promise<void> {
  try {
    await StatsService.incrementCaptured(siteId, hasGclid);
  } catch (err) {
    logWarn('REDIS_STATS_DEGRADED', {
      code: 'REDIS_STATS_DEGRADED',
      site_id: siteId,
      hasGclid,
      error: getErrorMessage(err),
    });
  }
}
