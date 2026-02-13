/**
 * Revenue Kernel PR-3: Quota Engine.
 * Monthly quota evaluation AFTER idempotency insert, BEFORE publish/fallback.
 * Invoice authority remains ingest_idempotency only; Redis is best-effort for UX and gating.
 */

import { adminClient } from '@/lib/supabase/admin';
import { redis } from '@/lib/upstash';
import { logWarn } from '@/lib/logging/logger';

const DEFAULT_HARD_CAP_MULTIPLIER = 2;
const PG_CONSERVATIVE_THRESHOLD = 0.95; // When Redis down and usage >= 95% of limit, allow with degraded header (pro tier choice)
const USAGE_KEY_PREFIX = 'usage:';
const CACHE_TTL_MS = 60_000; // 1 min cache for site plan

export type SitePlan = {
  site_id: string;
  monthly_limit: number;
  soft_limit_enabled: boolean;
  hard_cap_multiplier: number;
};

const defaultFreePlan: SitePlan = {
  site_id: '',
  monthly_limit: 1000,
  soft_limit_enabled: false,
  hard_cap_multiplier: DEFAULT_HARD_CAP_MULTIPLIER,
};

/** Per-site cache. Key = siteIdUuid only; never a single global entry for all sites. */
type CachedPlan = { plan: SitePlan; at: number };
const planCache = new Map<string, CachedPlan>();

/**
 * Current UTC month as YYYY-MM (for usage keys and DB year_month).
 */
export function getCurrentYearMonthUTC(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Fetch site plan from DB (service role). Uses short-lived in-memory cache.
 * If no row exists, returns default free plan (safe monthly_limit).
 */
export async function getSitePlan(siteIdUuid: string): Promise<SitePlan> {
  const entry = planCache.get(siteIdUuid);
  if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
    return { ...entry.plan, site_id: siteIdUuid };
  }

  let data: { monthly_limit?: number; soft_limit_enabled?: boolean; hard_cap_multiplier?: number } | null = null;
  let error: unknown = null;

  if (__planFetcherForTest) {
    try {
      data = await __planFetcherForTest(siteIdUuid);
    } catch (e) {
      error = e;
    }
  } else {
    const result = await adminClient
      .from('site_plans')
      .select('monthly_limit, soft_limit_enabled, hard_cap_multiplier')
      .eq('site_id', siteIdUuid)
      .maybeSingle();
    data = result.data;
    error = result.error;
  }

  if (error) {
    logWarn('QUOTA_PLAN_FETCH_ERROR', { site_id: siteIdUuid, error: String(error) });
    return { ...defaultFreePlan, site_id: siteIdUuid };
  }

  const plan: SitePlan = data
    ? {
        site_id: siteIdUuid,
        monthly_limit: Number(data.monthly_limit) || defaultFreePlan.monthly_limit,
        soft_limit_enabled: Boolean(data.soft_limit_enabled),
        hard_cap_multiplier: Number(data.hard_cap_multiplier) ?? DEFAULT_HARD_CAP_MULTIPLIER,
      }
    : { ...defaultFreePlan, site_id: siteIdUuid };

  planCache.set(siteIdUuid, { plan: { ...plan }, at: Date.now() });
  return plan;
}

/**
 * Invalidate plan cache (e.g. for tests). Clears all per-site entries.
 */
export function clearPlanCache(): void {
  planCache.clear();
}

/** Test-only: inject a fetcher to return plan data per site_id. Set to null to use DB. */
export let __planFetcherForTest: ((siteIdUuid: string) => Promise<{ monthly_limit: number; soft_limit_enabled: boolean; hard_cap_multiplier: number } | null>) | null = null;
export function _setPlanFetcherForTest(
  fn: ((siteIdUuid: string) => Promise<{ monthly_limit: number; soft_limit_enabled: boolean; hard_cap_multiplier: number } | null>) | null
): void {
  __planFetcherForTest = fn;
}

function usageKey(siteIdUuid: string, yearMonth: string): string {
  return `${USAGE_KEY_PREFIX}${siteIdUuid}:${yearMonth}`;
}

/**
 * Read current month usage from Redis (best-effort). Returns null on miss or error.
 * Target: <10ms for usage lookup.
 */
export async function getUsageRedis(siteIdUuid: string, yearMonth: string): Promise<number | null> {
  try {
    const key = usageKey(siteIdUuid, yearMonth);
    const val = await redis.get(key);
    if (val == null) return null;
    const n = typeof val === 'string' ? parseInt(val, 10) : Number(val);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Read usage from site_usage_monthly snapshot (PG). Used when Redis is down.
 */
export async function getUsagePgSnapshot(siteIdUuid: string, yearMonth: string): Promise<number | null> {
  const { data, error } = await adminClient
    .from('site_usage_monthly')
    .select('event_count')
    .eq('site_id', siteIdUuid)
    .eq('year_month', yearMonth)
    .maybeSingle();

  if (error || !data) return null;
  const n = Number((data as { event_count?: number }).event_count);
  return Number.isFinite(n) ? n : null;
}

/**
 * COUNT(*) from ingest_idempotency (billable=true) for site + month. Expensive fallback when snapshot missing.
 */
export async function getUsagePgCount(siteIdUuid: string, yearMonth: string): Promise<number> {
  const { count, error } = await adminClient
    .from('ingest_idempotency')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteIdUuid)
    .eq('year_month', yearMonth)
    .eq('billable', true);

  if (error) return 0;
  return typeof count === 'number' && Number.isFinite(count) ? count : 0;
}

/**
 * Resolve current usage: Redis first, then PG snapshot, then PG COUNT. Returns { usage, source }.
 * When Redis is down and we use PG, source is 'pg_snapshot' or 'pg_count'; caller may add x-opsmantik-degraded.
 */
export async function getUsage(
  siteIdUuid: string,
  yearMonth: string
): Promise<{ usage: number; source: 'redis' | 'pg_snapshot' | 'pg_count' }> {
  const fromRedis = await getUsageRedis(siteIdUuid, yearMonth);
  if (fromRedis !== null) return { usage: fromRedis, source: 'redis' };

  const fromSnapshot = await getUsagePgSnapshot(siteIdUuid, yearMonth);
  if (fromSnapshot !== null) return { usage: fromSnapshot, source: 'pg_snapshot' };

  const fromCount = await getUsagePgCount(siteIdUuid, yearMonth);
  return { usage: fromCount, source: 'pg_count' };
}

export type QuotaDecision =
  | { allow: true; overage: false; reject: false; reason?: string; hardCapHit?: false; headers: Record<string, string> }
  | { allow: true; overage: true; reject: false; reason?: string; hardCapHit?: false; headers: Record<string, string> }
  | { allow: false; overage: false; reject: true; reason: string; hardCapHit?: boolean; headers: Record<string, string> };

/**
 * Evaluate quota: usage vs monthly_limit and hard_cap. Returns decision and headers (quota-remaining, overage, etc.).
 */
export function evaluateQuota(
  plan: SitePlan,
  usage: number
): QuotaDecision {
  const limit = plan.monthly_limit;
  const hardCap = Math.floor(limit * (plan.hard_cap_multiplier ?? DEFAULT_HARD_CAP_MULTIPLIER));
  const remaining = Math.max(0, limit - usage);
  const baseHeaders: Record<string, string> = {
    'x-opsmantik-quota-remaining': String(remaining),
  };

  if (usage < limit) {
    return { allow: true, overage: false, reject: false, headers: baseHeaders };
  }

  if (plan.soft_limit_enabled) {
    if (usage >= hardCap) {
      return {
        allow: false,
        overage: false,
        reject: true,
        reason: 'hard_cap_exceeded',
        hardCapHit: true,
        headers: { ...baseHeaders, 'x-opsmantik-quota-exceeded': '1' },
      };
    }
    return {
      allow: true,
      overage: true,
      reject: false,
      headers: { ...baseHeaders, 'x-opsmantik-overage': 'true' },
    };
  }

  return {
    allow: false,
    overage: false,
    reject: true,
    reason: 'monthly_limit_exceeded',
    headers: { ...baseHeaders, 'x-opsmantik-quota-exceeded': '1' },
  };
}

/**
 * Seconds until next UTC month boundary (for Retry-After). Capped at ~32 days in seconds.
 */
export function computeRetryAfterToMonthRollover(): number {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const next = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  const sec = Math.ceil((next.getTime() - now.getTime()) / 1000);
  return Math.max(0, Math.min(sec, 32 * 24 * 3600)); // cap ~32 days
}

/**
 * Best-effort increment Redis usage counter for this site+month. Call only after publish or fallback success.
 * Failure is logged; reconciliation will correct site_usage_monthly later.
 */
export async function incrementUsageRedis(siteIdUuid: string, yearMonth: string): Promise<void> {
  try {
    const key = usageKey(siteIdUuid, yearMonth);
    await redis.incr(key);
    // Expire at end of next month so key doesn't leak
    const expireSec = 60 * 60 * 24 * 62; // ~62 days
    await redis.expire(key, expireSec);
  } catch (err) {
    logWarn('QUOTA_REDIS_INCREMENT_SKIP', { site_id: siteIdUuid, year_month: yearMonth, error: String(err) });
  }
}
