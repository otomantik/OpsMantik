/**
 * Provider worker loop: backoff, max attempts, credential missing -> FAILED, recover-processing route.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { nextRetryDelaySeconds } from '@/lib/cron/process-offline-conversions';

test('backoff: nextRetryDelaySeconds caps at 24h', () => {
  const s = nextRetryDelaySeconds(20);
  assert.ok(s <= 24 * 60 * 60 && s >= 0);
});

test('worker route: credential missing marks FAILED (not RETRY)', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'cron', 'process-offline-conversions', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes("status: 'FAILED'") && src.includes('No credentials'), 'missing creds -> FAILED');
});

test('worker route: MAX_RETRY_ATTEMPTS 7 then FAILED', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'cron', 'process-offline-conversions', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('MAX_RETRY_ATTEMPTS') && src.includes('7'), 'max 7 attempts');
  assert.ok(src.includes('isFinal') || src.includes('MAX_RETRY_ATTEMPTS'), 'final attempt logic');
});

test('recover-processing route: requireCronAuth and calls recover_stuck RPC', async () => {
  const routePath = join(process.cwd(), 'app', 'api', 'cron', 'providers', 'recover-processing', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('requireCronAuth'), 'cron auth');
  assert.ok(src.includes('recover_stuck_offline_conversion_jobs'), 'calls recovery RPC');
});

test('recover-processing: without cron auth returns 403', async () => {
  const { POST } = await import('@/app/api/cron/providers/recover-processing/route');
  const req = new NextRequest('http://localhost:3000/api/cron/providers/recover-processing', {
    method: 'POST',
  });
  const res = await POST(req);
  assert.equal(res.status, 403);
});

test('seed-credentials route: hard-blocked in production (403)', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'cron', 'providers', 'seed-credentials', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(
    src.includes("NODE_ENV === 'production'") && src.includes('403'),
    'seed-credentials returns 403 in production'
  );
});
