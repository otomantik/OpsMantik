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

test('vercel schedules OCI sweep-zombies recovery cron', () => {
  const src = readFileSync(VERCEL_PATH, 'utf8');
  assert.ok(src.includes('/api/cron/oci/sweep-zombies'), 'vercel cron must schedule OCI sweep-zombies');
});

test('vercel schedules OCI recover-stuck-signals cron', () => {
  const src = readFileSync(VERCEL_PATH, 'utf8');
  assert.ok(src.includes('/api/cron/oci/recover-stuck-signals'), 'vercel cron must schedule OCI recover-stuck-signals');
});
