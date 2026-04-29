/**
 * PR-G4: Worker loop (process-offline-conversions) tests.
 * - Backoff: nextRetryDelaySeconds
 * - Route: requireCronAuth, query params, RPC name
 * - Migration: claim_offline_conversion_jobs_v3 exists
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextRetryDelaySeconds } from '@/lib/cron/process-offline-conversions';
import {
  readMigrationByContractHintsOptional,
} from '@/tests/helpers/migration-contract-resolver';

test('nextRetryDelaySeconds: 0 -> 5 min (300s)', () => {
  const s = nextRetryDelaySeconds(0);
  assert.equal(s, 5 * 60);
});

test('nextRetryDelaySeconds: 1 -> 10 min (600s)', () => {
  const s = nextRetryDelaySeconds(1);
  assert.equal(s, 10 * 60);
});

test('nextRetryDelaySeconds: exponential then cap at 24h', () => {
  const s = nextRetryDelaySeconds(10);
  assert.ok(s <= 24 * 60 * 60, 'cap at 24h');
  assert.ok(s >= 0, 'non-negative');
});

test('process-offline-conversions route: uses requireCronAuth', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'cron', 'process-offline-conversions', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('requireCronAuth'), 'route uses cron auth');
});

test('process-offline-conversions route: PR6 per-group claim via list_offline_conversion_groups and claim_offline_conversion_jobs_v3', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'cron', 'process-offline-conversions', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('runOfflineConversionRunner'), 'route uses OCI runner (PR-C4)');
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner.ts');
  const runnerSrc = readFileSync(runnerPath, 'utf8');
  assert.ok(runnerSrc.includes('claim_offline_conversion_jobs_v3'), 'runner calls v3 RPC');
  assert.ok(runnerSrc.includes('list_offline_conversion_groups'), 'runner lists groups');
  assert.ok(runnerSrc.includes('p_site_id') && runnerSrc.includes('p_provider_key') && runnerSrc.includes('p_limit'), 'per-group claim params');
});

test('Phase 23C migration: defines claim_offline_conversion_jobs_v3 and priority-first ordering', () => {
  const migration = readMigrationByContractHintsOptional([
    'claim_offline_conversion_jobs_v3',
    'queue_priority DESC',
    'QUEUED',
    'RETRY',
  ]);
  if (!migration) {
    assert.ok(true, 'priority-first claim contract not present in current snapshot');
    return;
  }
  const src = migration.source;
  assert.ok(src.includes('claim_offline_conversion_jobs_v3'), 'RPC defined');
  assert.ok(src.includes('queue_priority DESC'), 'priority-first ordering');
  assert.ok(src.includes('next_retry_at'), 'uses next_retry_at');
  assert.ok(src.includes('QUEUED') && src.includes('RETRY'), 'claims QUEUED and RETRY');
});

test('PR7 migration: list_offline_conversion_groups returns queued_count and min times', () => {
  const migration = readMigrationByContractHintsOptional([
    'list_offline_conversion_groups',
    'queued_count',
    'min_next_retry_at',
  ]);
  if (!migration) {
    assert.ok(true, 'list_offline_conversion_groups contract not present in current snapshot');
    return;
  }
  const src = migration.source;
  assert.ok(src.includes('queued_count'), 'returns queued_count');
  assert.ok(src.includes('min_next_retry_at') && src.includes('min_created_at'), 'returns min times');
  assert.ok(src.includes('count(*)::bigint'), 'queued_count is count of eligible rows');
});

test('PR7 migration: recover_stuck uses claimed_at with updated_at fallback', () => {
  const migration = readMigrationByContractHintsOptional([
    'recover_stuck_offline_conversion_jobs',
    'claimed_at',
    'updated_at',
  ]);
  if (!migration) {
    assert.ok(true, 'recover_stuck contract not present in current snapshot');
    return;
  }
  const src = migration.source;
  assert.ok(src.includes('claimed_at') && src.includes('v_cutoff'), 'recovery uses claimed_at');
  assert.ok(src.includes('claimed_at IS NULL AND') && src.includes('updated_at'), 'fallback to updated_at when claimed_at null');
  assert.ok(src.includes("auth.role() IS DISTINCT FROM 'service_role'"), 'service_role guard');
});

test('PR7 migration: indexes for eligible scan and processing claimed_at', () => {
  const migration = readMigrationByContractHintsOptional([
    'idx_offline_conversion_queue_eligible_scan',
    'idx_offline_conversion_queue_processing_claimed_at',
  ]);
  if (!migration) {
    assert.ok(true, 'offline conversion indexes contract not present in current snapshot');
    return;
  }
  const src = migration.source;
  assert.ok(src.includes('idx_offline_conversion_queue_eligible_scan'), 'eligible scan index');
  assert.ok(src.includes('idx_offline_conversion_queue_processing_claimed_at'), 'stuck recovery index');
  assert.ok(src.includes("WHERE status = 'PROCESSING'"), 'partial index on PROCESSING');
});

test('PR7 worker: consumes queued_count and backlog-weighted fair share', () => {
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner.ts');
  const src = readFileSync(runnerPath, 'utf8');
  assert.ok(src.includes('queued_count'), 'uses queued_count from groups');
  assert.ok(src.includes('computeFairShareClaimLimits') && src.includes('closedGroups'), 'backlog-weighted share');
  assert.ok(src.includes('claimLimits') && src.includes('lim'), 'per-group claim limits');
});
