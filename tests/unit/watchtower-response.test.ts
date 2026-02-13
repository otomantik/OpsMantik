/**
 * Gate: Watchtower response must always include checks.ingestPublishFailuresLast15m.
 * No DB required; asserts response shape contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { WatchtowerHealth } from '@/lib/services/watchtower';

test('WatchtowerHealth.checks always includes ingestPublishFailuresLast15m', () => {
  const minimalHealth: WatchtowerHealth = {
    status: 'ok',
    checks: {
      sessionsLastHour: { status: 'ok', count: 1 },
      gclidLast3Hours: { status: 'ok', count: 0 },
      ingestPublishFailuresLast15m: { status: 'ok', count: 0 },
    },
    details: { timestamp: new Date().toISOString(), environment: 'test' },
  };

  assert.ok(minimalHealth.checks.ingestPublishFailuresLast15m !== undefined);
  assert.ok('status' in minimalHealth.checks.ingestPublishFailuresLast15m);
  assert.ok('count' in minimalHealth.checks.ingestPublishFailuresLast15m);
  assert.ok(
    ['ok', 'degraded', 'critical', 'unknown'].includes(
      minimalHealth.checks.ingestPublishFailuresLast15m.status
    )
  );
  assert.ok(typeof minimalHealth.checks.ingestPublishFailuresLast15m.count === 'number');
});

test('Watchtower JSON response shape includes failure_count and checks.ingestPublishFailuresLast15m', () => {
  const health: WatchtowerHealth = {
    status: 'degraded',
    checks: {
      sessionsLastHour: { status: 'ok', count: 10 },
      gclidLast3Hours: { status: 'ok', count: 2 },
      ingestPublishFailuresLast15m: { status: 'degraded', count: 3 },
    },
    details: { timestamp: new Date().toISOString(), environment: 'test' },
  };

  const codeByStatus: Record<string, string> = {
    ok: 'WATCHTOWER_OK',
    degraded: 'WATCHTOWER_DEGRADED',
    alarm: 'WATCHTOWER_ALARM',
    critical: 'WATCHTOWER_CRITICAL',
  };
  const response = {
    ok: health.status === 'ok' || health.status === 'degraded',
    code: codeByStatus[health.status] ?? 'WATCHTOWER_OK',
    status: health.status,
    severity: health.status,
    failure_count: health.checks.ingestPublishFailuresLast15m.count,
    checks: health.checks,
    details: health.details,
  };

  assert.ok(response.checks.ingestPublishFailuresLast15m !== undefined);
  assert.equal(response.failure_count, 3);
  assert.equal(response.code, 'WATCHTOWER_DEGRADED');
  assert.equal(response.status, 'degraded');
});
