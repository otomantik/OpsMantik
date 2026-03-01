/**
 * OCI attempt-cap: route and RPC behavior.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

test('attempt-cap route: requireCronAuth', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'cron', 'oci', 'attempt-cap', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('requireCronAuth'), 'uses cron auth');
});

test('attempt-cap route: calls oci_attempt_cap RPC', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'cron', 'oci', 'attempt-cap', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('oci_attempt_cap'), 'calls attempt-cap RPC');
});

test('attempt-cap route: without cron auth returns 403', async () => {
  const { GET } = await import('@/app/api/cron/oci/attempt-cap/route');
  const req = new NextRequest('http://localhost:3000/api/cron/oci/attempt-cap');
  const res = await GET(req);
  assert.equal(res.status, 403);
});

test('attempt-cap migration: RPC sets FAILED with MAX_ATTEMPTS', () => {
  const migrationPath = join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260330000000_oci_claim_and_attempt_cap.sql'
  );
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes("status = 'FAILED'"), 'sets FAILED');
  assert.ok(src.includes("provider_error_code = 'MAX_ATTEMPTS'"), 'sets provider_error_code');
  assert.ok(src.includes("provider_error_category = 'PERMANENT'"), 'sets PERMANENT');
  assert.ok(src.includes("last_error = 'MAX_ATTEMPTS_EXCEEDED'"), 'sets last_error');
});

test('MAX_ATTEMPTS constant is 5', async () => {
  const { MAX_ATTEMPTS } = await import('@/lib/domain/oci/queue-types');
  assert.equal(MAX_ATTEMPTS, 5);
});
