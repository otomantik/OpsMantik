/**
 * Sync worker must be resilient to Redis outages: stats increment is best-effort.
 * Redis failure must NOT fail the job (no DLQ for stats-only failures).
 *
 * When run in isolation you may see one "UPSTASH redis credentials missing" log from lib/upstash
 * on load; that is expected when Redis env is unset and is not a test failure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { StatsService } from '@/lib/services/stats-service';
import { incrementCapturedSafe } from '@/lib/sync/worker-stats';

test('incrementCapturedSafe: when Redis throws, does not throw and job can continue', async () => {
  const original = StatsService.incrementCaptured;
  try {
    StatsService.incrementCaptured = async () => {
      throw new Error('Connection refused (Redis down)');
    };
    await assert.doesNotReject(incrementCapturedSafe('site-123', true));
  } finally {
    StatsService.incrementCaptured = original;
  }
});

test('incrementCapturedSafe: when Redis throws, resolves (no exception)', async () => {
  const original = StatsService.incrementCaptured;
  try {
    StatsService.incrementCaptured = async () => {
      throw new Error('ECONNREFUSED');
    };
    const result = incrementCapturedSafe('site-456', false);
    await result;
    assert.ok(true, 'incrementCapturedSafe resolved');
  } finally {
    StatsService.incrementCaptured = original;
  }
});
