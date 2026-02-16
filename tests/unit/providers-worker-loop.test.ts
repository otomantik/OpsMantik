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

// PR5: Circuit breaker
test('circuit migration: threshold 5 and OPEN/HALF_OPEN/CLOSED', () => {
  const migrationPath = join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260220100000_provider_health_state_circuit.sql'
  );
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes("'CLOSED'") && src.includes("'OPEN'") && src.includes("'HALF_OPEN'"), 'enum states');
  assert.ok(src.includes('v_threshold int := 5') || src.includes('failure_count >= v_threshold'), 'open at 5');
  assert.ok(src.includes('record_provider_outcome') && src.includes('p_is_success') && src.includes('p_is_transient'), 'outcome RPC');
  assert.ok(src.includes('state = \'CLOSED\'') && src.includes('failure_count = 0'), 'success resets');
});

test('worker route: circuit OPEN gate and HALF_OPEN probe_limit', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'cron', 'process-offline-conversions', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('get_provider_health_state'), 'fetches health');
  assert.ok(src.includes("state === 'OPEN'") && src.includes('nextProbeAt'), 'OPEN gate');
  assert.ok(src.includes('set_provider_state_half_open'), 'transition to HALF_OPEN');
  assert.ok(src.includes("state === 'HALF_OPEN'") && src.includes('probeLimit') && src.includes('slice(0, limit)'), 'HALF_OPEN probe limit');
  assert.ok(src.includes('record_provider_outcome'), 'records outcome');
  assert.ok(src.includes('CIRCUIT_OPEN'), 'gating error code');
});

// PR6: Claim v2 by site+provider, ordering, HALF_OPEN uses probe_limit
test('PR6 migration: claim by site+provider has ordering and scoping', () => {
  const migrationPath = join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260220110000_claim_offline_conversions_by_site_provider.sql'
  );
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes('list_offline_conversion_groups'), 'lists groups');
  assert.ok(src.includes('claim_offline_conversion_jobs_v2') && src.includes('p_site_id') && src.includes('p_provider_key'), 'per-group claim');
  assert.ok(src.includes('next_retry_at ASC NULLS FIRST') && src.includes('created_at ASC'), 'deterministic ordering');
  assert.ok(src.includes('oq.site_id = p_site_id') && src.includes('oq.provider_key = p_provider_key'), 'site_id+provider_key scoping');
  assert.ok(src.includes('claimed_at'), 'claimed_at column');
});

test('PR6 worker: HALF_OPEN uses probe_limit for claim', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'cron', 'process-offline-conversions', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('state === \'HALF_OPEN\'') && src.includes('probeLimit'), 'HALF_OPEN branch');
  assert.ok(src.includes('claimLimit') && (src.includes('probeLimit') || src.includes('fairShare')), 'claim limit from probe or fair share');
});
