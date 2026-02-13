/**
 * Revenue Kernel PR-4: Reconciliation — site_usage_monthly from Postgres SoT only.
 * Authority: COUNT(ingest_idempotency WHERE billable=true) per (site_id, year_month).
 * Redis correction is best-effort; never fail the job on Redis errors.
 */

import { adminClient as _adminClient } from '@/lib/supabase/admin';
import { redis as _redis } from '@/lib/upstash';
import { getCurrentYearMonthUTC } from '@/lib/quota';

/** Test-only: inject client; null = use real adminClient */
let __adminClientForTest: typeof _adminClient | null = null;
/** Test-only: inject redis; null = use real redis */
let __redisForTest: { get: (k: string) => Promise<unknown>; set: (k: string, v: string) => Promise<unknown>; expire: (k: string, s: number) => Promise<unknown> } | null = null;

export function _setReconciliationClientsForTest(
  client: typeof _adminClient | null,
  redisMock: typeof __redisForTest
): void {
  __adminClientForTest = client;
  __redisForTest = redisMock;
}

/** Test-only: assert mock is in use */
export function _getReconciliationClientForTest(): typeof _adminClient | null {
  return __adminClientForTest;
}

const adminClient = () => __adminClientForTest ?? _adminClient;
const redis = () => __redisForTest ?? _redis;

const USAGE_KEY_PREFIX = 'usage:';
const DRIFT_THRESHOLD_ABS = 10;
const DRIFT_THRESHOLD_PCT = 0.01;

export type ReconcileResult = {
  pg_count_billable: number;
  pg_count_overage: number;
  updated_usage_row: { event_count: number; overage_count: number; last_synced_at: string };
  drift?: { redis?: number; pg?: number; abs?: number; pct?: number };
};

function usageKey(siteIdUuid: string, yearMonth: string): string {
  return `${USAGE_KEY_PREFIX}${siteIdUuid}:${yearMonth}`;
}

/**
 * Seconds until end of the given UTC month (for Redis key expiry).
 */
function secondsToEndOfMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59)); // last day of month
  const now = new Date();
  const sec = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 1000));
  return Math.min(sec, 60 * 60 * 24 * 62); // cap ~62 days
}

/**
 * Reconcile usage for one (site_id, year_month):
 * 1) COUNT billable and overage from ingest_idempotency (SoT).
 * 2) UPSERT site_usage_monthly.
 * 3) Optionally correct Redis if drift > max(10, 1% of billable); best-effort, never throw.
 */
export async function reconcileUsageForMonth(
  siteIdUuid: string,
  yearMonth: string
): Promise<ReconcileResult> {
  // 1) Counts from ingest_idempotency (authority)
  const client = adminClient();
  const { count: billableCount, error: billableError } = await client
    .from('ingest_idempotency')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteIdUuid)
    .eq('year_month', yearMonth)
    .eq('billable', true);

  if (billableError) {
    throw new Error(`reconcile billable count failed: ${billableError.message}`);
  }

  const pg_count_billable = typeof billableCount === 'number' && Number.isFinite(billableCount) ? billableCount : 0;

  const { count: overageCount, error: overageError } = await client
    .from('ingest_idempotency')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteIdUuid)
    .eq('year_month', yearMonth)
    .eq('billable', true)
    .eq('billing_state', 'OVERAGE');

  if (overageError) {
    throw new Error(`reconcile overage count failed: ${overageError.message}`);
  }

  const pg_count_overage = typeof overageCount === 'number' && Number.isFinite(overageCount) ? overageCount : 0;

  const last_synced_at = new Date().toISOString();

  // 2) UPSERT site_usage_monthly
  const { error: upsertError } = await client.from('site_usage_monthly').upsert(
    {
      site_id: siteIdUuid,
      year_month: yearMonth,
      event_count: pg_count_billable,
      overage_count: pg_count_overage,
      last_synced_at,
    },
    { onConflict: 'site_id,year_month' }
  );

  if (upsertError) {
    throw new Error(`reconcile upsert site_usage_monthly failed: ${upsertError.message}`);
  }

  const updated_usage_row = {
    event_count: pg_count_billable,
    overage_count: pg_count_overage,
    last_synced_at,
  };

  // 3) Redis correction (best-effort; never fail job)
  let drift: ReconcileResult['drift'] | undefined;
  const redisClient = redis();
  try {
    const key = usageKey(siteIdUuid, yearMonth);
    const redisVal = await redisClient.get(key);
    const redisCount = redisVal != null ? (typeof redisVal === 'string' ? parseInt(redisVal, 10) : Number(redisVal)) : null;

    if (redisCount !== null && Number.isFinite(redisCount)) {
      const absDrift = Math.abs(redisCount - pg_count_billable);
      const pctDrift = pg_count_billable > 0 ? absDrift / pg_count_billable : 0;
      const threshold = Math.max(DRIFT_THRESHOLD_ABS, pg_count_billable * DRIFT_THRESHOLD_PCT);
      drift = { redis: redisCount, pg: pg_count_billable, abs: absDrift, pct: pctDrift };

      if (absDrift > threshold) {
        await redisClient.set(key, String(pg_count_billable));
        const expireSec = secondsToEndOfMonth(yearMonth);
        await redisClient.expire(key, expireSec);
      }
    } else {
      // Optional: set Redis when missing (best-effort)
      await redisClient.set(key, String(pg_count_billable));
      const expireSec = secondsToEndOfMonth(yearMonth);
      await redisClient.expire(key, expireSec);
    }
  } catch {
    // Never fail the job because of Redis
  }

  return {
    pg_count_billable,
    pg_count_overage,
    updated_usage_row,
    drift,
  };
}

export { getCurrentYearMonthUTC };
