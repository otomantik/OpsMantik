import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WATCHTOWER_PATH = join(process.cwd(), 'lib', 'services', 'watchtower.ts');
const VERCEL_PATH = join(process.cwd(), 'vercel.json');

test('watchtower notifies on degraded, alarm, and critical states', () => {
  const src = readFileSync(WATCHTOWER_PATH, 'utf8');
  assert.ok(src.includes("status === 'degraded'") && src.includes("status === 'critical'"), 'watchtower should notify on degraded and critical states');
  assert.ok(src.includes('WATCHTOWER DEGRADED'), 'degraded notification title must exist');
  assert.ok(src.includes('WATCHTOWER CRITICAL'), 'critical notification title must exist');
  assert.ok(src.includes("TelegramService.sendMessage(alertMessage, levelByStatus[health.status])"), 'watchtower should route severity-aware telegram notifications');
});

// The six legacy OCI recovery/sweep crons (sweep-zombies, recover-stuck-signals,
// attempt-cap, sweep-unsent-conversions, pulse-recovery, providers/recover-processing)
// were consolidated into a single /api/cron/oci-maintenance orchestrator. The
// individual routes still exist for manual invocation but are no longer scheduled.
test('vercel schedules consolidated OCI maintenance cron', () => {
  const src = readFileSync(VERCEL_PATH, 'utf8');
  assert.ok(
    src.includes('/api/cron/oci-maintenance'),
    'vercel cron must schedule /api/cron/oci-maintenance (consolidated zombie+pulse+attempt-cap sweep)'
  );
});

test('vercel no longer schedules the six legacy OCI recovery crons separately', () => {
  const src = readFileSync(VERCEL_PATH, 'utf8');
  const legacyPaths = [
    '/api/cron/oci/sweep-zombies',
    '/api/cron/oci/recover-stuck-signals',
    '/api/cron/oci/attempt-cap',
    '/api/cron/sweep-unsent-conversions',
    '/api/cron/pulse-recovery',
    '/api/cron/providers/recover-processing',
  ];
  for (const p of legacyPaths) {
    assert.ok(
      !src.includes(p),
      `vercel.json must not schedule ${p} separately — it is now covered by /api/cron/oci-maintenance`
    );
  }
});
