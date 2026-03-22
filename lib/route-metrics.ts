/**
 * P0 observability: HTTP outcome counters for critical ingest routes (Redis + in-memory fallback).
 * Used by GET /api/metrics for sync_error_rate / call_event_error_rate denominators (monotonic since deploy or key TTL).
 */

import { logInfo } from '@/lib/logging/logger';
import { redis } from '@/lib/upstash';

const ROUTE_REDIS_PREFIX = 'route:';

export type RouteMetricName = 'sync' | 'call_event_v2';

const ROUTE_KEYS: Record<RouteMetricName, readonly string[]> = {
  sync: ['route_sync_requests_total', 'route_sync_http_2xx', 'route_sync_http_3xx', 'route_sync_http_4xx', 'route_sync_http_5xx'],
  call_event_v2: [
    'route_call_event_v2_requests_total',
    'route_call_event_v2_http_2xx',
    'route_call_event_v2_http_3xx',
    'route_call_event_v2_http_4xx',
    'route_call_event_v2_http_5xx',
  ],
};

const allCounterNames = [...new Set([...ROUTE_KEYS.sync, ...ROUTE_KEYS.call_event_v2])];

const memory: Record<string, number> = Object.fromEntries(allCounterNames.map((k) => [k, 0]));

const ROUTE_COUNTER_TTL_SEC = 365 * 24 * 60 * 60;

function redisKey(metric: string): string {
  return ROUTE_REDIS_PREFIX + metric;
}

function bandForStatus(status: number): '2xx' | '3xx' | '4xx' | '5xx' {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  return '2xx';
}

/** Call once per completed response (after status is known). Best-effort Redis INCR. */
export function recordRouteHttpResponse(route: RouteMetricName, status: number): void {
  const band = bandForStatus(status);
  const totalKey = route === 'sync' ? 'route_sync_requests_total' : 'route_call_event_v2_requests_total';
  const bandKey =
    route === 'sync'
      ? `route_sync_http_${band}`
      : `route_call_event_v2_http_${band}`;

  memory[totalKey] = (memory[totalKey] ?? 0) + 1;
  memory[bandKey] = (memory[bandKey] ?? 0) + 1;
  logInfo('ROUTE_METRIC', { route, status, band, totalKey });

  const pipe = redis.pipeline();
  pipe.incr(redisKey(totalKey));
  pipe.expire(redisKey(totalKey), ROUTE_COUNTER_TTL_SEC);
  pipe.incr(redisKey(bandKey));
  pipe.expire(redisKey(bandKey), ROUTE_COUNTER_TTL_SEC);
  pipe.exec().catch(() => {
    /* best-effort */
  });
}

export function getRouteMetricsMemory(): Record<string, number> {
  return { ...memory };
}

export async function getRouteMetricsFromRedis(): Promise<Record<string, number> | null> {
  const keys = allCounterNames.map(redisKey);
  try {
    const values = await redis.mget(...keys);
    const out: Record<string, number> = {};
    allCounterNames.forEach((name, i) => {
      const v = values?.[i];
      const n = typeof v === 'number' ? v : Number(v);
      out[name] = Number.isFinite(n) ? n : 0;
    });
    return out;
  } catch {
    return null;
  }
}

/** Approximate server error rate: 5xx / total (monotonic counters). */
export function computeApproxErrorRate(route: RouteMetricName, m: Record<string, number>): { total: number; http_5xx: number; error_rate: number | null } {
  const totalKey = route === 'sync' ? 'route_sync_requests_total' : 'route_call_event_v2_requests_total';
  const fiveKey = route === 'sync' ? 'route_sync_http_5xx' : 'route_call_event_v2_http_5xx';
  const total = m[totalKey] ?? 0;
  const http_5xx = m[fiveKey] ?? 0;
  if (total <= 0) return { total, http_5xx, error_rate: null };
  return { total, http_5xx, error_rate: http_5xx / total };
}
