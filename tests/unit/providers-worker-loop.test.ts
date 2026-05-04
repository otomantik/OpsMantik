/**
 * Provider worker loop: backoff, max attempts, credential missing -> FAILED, recover-processing route.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSchemaUtf8, schemaUtf8Slice } from '@/tests/helpers/schema-utf8-contract';
import { NextRequest } from 'next/server';
import { nextRetryDelaySeconds } from '@/lib/cron/process-offline-conversions';

test('backoff: nextRetryDelaySeconds caps at 24h', () => {
  const s = nextRetryDelaySeconds(20);
  assert.ok(s <= 24 * 60 * 60 && s >= 0);
});

test('worker route: credential missing marks FAILED (not RETRY)', () => {
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner.ts');
  const src = readFileSync(runnerPath, 'utf8');
  assert.ok(src.includes("status: 'FAILED'") && (src.includes('Credentials missing') || src.includes('No credentials')), 'missing creds -> FAILED');
});

test('worker route: MAX_RETRY_ATTEMPTS 7 then FAILED', () => {
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner', 'cron-wave.ts');
  const constantsPath = join(process.cwd(), 'lib', 'oci', 'constants.ts');
  const runnerSrc = readFileSync(runnerPath, 'utf8');
  const constantsSrc = readFileSync(constantsPath, 'utf8');
  assert.ok(runnerSrc.includes('MAX_RETRY_ATTEMPTS'), 'runner uses MAX_RETRY_ATTEMPTS');
  assert.ok(constantsSrc.includes('MAX_RETRY_ATTEMPTS') && constantsSrc.includes('7'), 'constants define max 7 attempts');
  assert.ok(runnerSrc.includes('isFinal') || runnerSrc.includes('MAX_RETRY_ATTEMPTS'), 'final attempt logic');
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

test('recover-stuck-signals route: requireCronAuth and calls recover_stuck_marketing_signals RPC', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'cron', 'oci', 'recover-stuck-signals', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('requireCronAuth'), 'cron auth');
  assert.ok(src.includes('recover_stuck_marketing_signals'), 'calls recovery RPC');
});

test('recover-stuck-signals: without cron auth returns 403', async () => {
  const { POST } = await import('@/app/api/cron/oci/recover-stuck-signals/route');
  const req = new NextRequest('http://localhost:3000/api/cron/oci/recover-stuck-signals', { method: 'POST' });
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
  const enumSrc = schemaUtf8Slice(
    'CREATE TYPE "public"."provider_circuit_state" AS ENUM',
    'CREATE OR REPLACE FUNCTION "private"."get_site_secrets"'
  );
  const recordSrc = schemaUtf8Slice(
    'CREATE OR REPLACE FUNCTION "public"."record_provider_outcome"',
    'CREATE OR REPLACE FUNCTION "public"."recover_stuck_ingest_fallback"'
  );
  assert.ok(enumSrc.includes("'CLOSED'") && enumSrc.includes("'OPEN'") && enumSrc.includes("'HALF_OPEN'"), 'enum states');
  assert.ok(recordSrc.includes('v_threshold int := 5') || recordSrc.includes('failure_count >= v_threshold'), 'open at 5');
  assert.ok(
    recordSrc.includes('record_provider_outcome') && recordSrc.includes('p_is_success') && recordSrc.includes('p_is_transient'),
    'outcome RPC'
  );
  assert.ok(recordSrc.includes('state = \'CLOSED\'') && recordSrc.includes('failure_count = 0'), 'success resets');
});

test('worker route: circuit OPEN gate and HALF_OPEN probe_limit', () => {
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner', 'cron-wave.ts');
  const src = readFileSync(runnerPath, 'utf8');
  assert.ok(src.includes('get_provider_health_state'), 'fetches health');
  assert.ok(src.includes("state === 'OPEN'") && src.includes('nextProbeAt'), 'OPEN gate');
  assert.ok(src.includes('set_provider_state_half_open'), 'transition to HALF_OPEN');
  assert.ok(src.includes("state === 'HALF_OPEN'") && src.includes('probeLimit') && src.includes('slice'), 'HALF_OPEN probe limit');
  assert.ok(src.includes('persistProviderOutcome'), 'records outcome');
  assert.ok(src.includes('CIRCUIT_OPEN'), 'gating error code');
});

// PR6 / Phase 23C: Claim by site+provider, ordering, HALF_OPEN uses probe_limit
test('PR6 migration: claim by site+provider has ordering and scoping', () => {
  const claimSrc = schemaUtf8Slice(
    'CREATE OR REPLACE FUNCTION "public"."claim_offline_conversion_jobs_v3"',
    'CREATE OR REPLACE FUNCTION "public"."claim_offline_conversion_rows_for_script_export"'
  );
  const full = getSchemaUtf8();
  assert.ok(full.includes('list_offline_conversion_groups'), 'schema lists offline conversion groups');
  assert.ok(
    (claimSrc.includes('claim_offline_conversion_jobs_v2') || claimSrc.includes('claim_offline_conversion_jobs_v3')) &&
      claimSrc.includes('p_site_id') &&
      claimSrc.includes('p_provider_key'),
    'per-site+provider claim RPC'
  );
  assert.ok(
    claimSrc.includes('next_retry_at ASC NULLS FIRST') && claimSrc.includes('created_at ASC'),
    'deterministic ordering'
  );
  assert.ok(
    claimSrc.includes('oq.site_id = p_site_id') && claimSrc.includes('oq.provider_key = p_provider_key'),
    'site_id+provider_key scoping'
  );
});

test('PR6 worker: HALF_OPEN uses probe_limit for claim', () => {
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner.ts');
  const src = readFileSync(runnerPath, 'utf8');
  assert.ok(src.includes('state === \'HALF_OPEN\'') && src.includes('probeLimit'), 'HALF_OPEN branch');
  assert.ok(src.includes('claimLimit') && (src.includes('probeLimit') || src.includes('claimLimits')), 'claim limit from probe or fair share');
});

test('PR7 worker: no starvation — min 1 when remaining allows', () => {
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner', 'claim-planner.ts');
  const src = readFileSync(runnerPath, 'utf8');
  assert.ok(src.includes('Math.max(1,') && src.includes('totalQueued'), 'weighted share gives at least 1');
});

test('PR9 google-ads-oci worker: sets upload proof fields (uploaded_at, provider_request_id, provider_error_*)', () => {
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner', 'process-conversion-batch.ts');
  const src = readFileSync(runnerPath, 'utf8');
  assert.ok(src.includes('uploaded_at'), 'COMPLETED sets uploaded_at');
  assert.ok(src.includes('provider_request_id'), 'COMPLETED sets provider_request_id');
  assert.ok(src.includes('provider_error_code'), 'FAILED/RETRY set provider_error_code');
  assert.ok(src.includes('provider_error_category'), 'FAILED/RETRY set provider_error_category');
});

test('runner bulk ledger append fails closed when any chunk write fails', () => {
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner', 'queue-bulk-update.ts');
  const src = readFileSync(runnerPath, 'utf8');
  assert.ok(src.includes('const failures: string[] = [];'), 'runner tracks failed ledger chunks');
  assert.ok(src.includes('chunk(s) failed'), 'runner must throw after partial ledger failure');
});

test('PR10 migration: provider_upload_attempts table exists with required columns', () => {
  const src = schemaUtf8Slice(
    'CREATE TABLE IF NOT EXISTS "public"."provider_upload_attempts"',
    'CREATE TABLE IF NOT EXISTS "public"."provider_upload_metrics"'
  );
  assert.ok(src.includes('provider_upload_attempts'), 'table name');
  assert.ok(src.includes('batch_id') && src.includes('phase'), 'batch_id and phase');
  assert.ok(src.includes("'STARTED'") && src.includes("'FINISHED'"), 'phase check');
  assert.ok(src.includes('claimed_count') && src.includes('completed_count') && src.includes('failed_count') && src.includes('retry_count'), 'counts');
  assert.ok(src.includes('duration_ms') && src.includes('provider_request_id') && src.includes('error_code'), 'FINISHED fields');
});

test('PR11 google-ads-oci worker: semaphore acquire/release and CONCURRENCY_LIMIT path', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'workers', 'google-ads-oci', 'route.ts');
  const routeSrc = readFileSync(routePath, 'utf8');
  assert.ok(routeSrc.includes('runOfflineConversionRunner') && routeSrc.includes("providerKey: 'google_ads'"), 'route calls runner for google_ads');
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner', 'worker-wave.ts');
  const src = readFileSync(runnerPath, 'utf8');
  assert.ok(src.includes('acquireSemaphore') && src.includes('releaseSemaphore'), 'semaphore acquire/release');
  assert.ok(src.includes('CONCURRENCY_LIMIT'), 'concurrency limit error path');
  assert.ok(src.includes('siteProviderKey') && src.includes('globalProviderKey'), 'key helpers');
  assert.ok(src.includes('CONCURRENCY_PER_SITE_PROVIDER') || src.includes('CONCURRENCY_GLOBAL'), 'env limits');
  assert.ok(src.includes('releaseSemaphore(siteKey') && src.includes('releaseSemaphore(globalKey'), 'release in finally');
});

test('PR10 google-ads-oci worker: writes STARTED before upload and FINISHED after (ledger)', () => {
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner', 'worker-wave.ts');
  const src = readFileSync(runnerPath, 'utf8');
  assert.ok(src.includes('provider_upload_attempts'), 'ledger table');
  assert.ok(src.includes("phase: 'STARTED'") || src.includes('phase: "STARTED"'), 'STARTED row');
  assert.ok(src.includes("phase: 'FINISHED'") || src.includes('phase: "FINISHED"'), 'FINISHED row');
  assert.ok(src.includes('claimed_count: siteRows.length'), 'STARTED has claimed_count');
  assert.ok(src.includes('duration_ms: durationMs') || src.includes('duration_ms'), 'FINISHED has duration_ms');
  assert.ok(src.includes('const startedAt = Date.now()'), 'STARTED timestamp must be captured before batch processing');
  assert.ok(src.includes('await processConversionBatch({'), 'FINISHED should be written after batch processing returns');
});
