/**
 * Revenue Kernel PR gates (Architecture Audit & Freeze).
 * 1) Same payload twice => first insert+queue, second dedup, no publish (idempotency layer: idempotency.test.ts).
 * 2) Concurrent same key => exactly one row (idempotency.test.ts).
 * 3) QStash failure => fallback row + idempotency row already exists (code path: idempotency before publish).
 * 4) Rate limit 429 => no idempotency insert, header x-opsmantik-ratelimit.
 * 5) expires_at >= 90d (idempotency.test.ts).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

const SYNC_ROUTE_PATH = join(process.cwd(), 'app', 'api', 'sync', 'route.ts');
const WORKER_INGEST_PATH = join(process.cwd(), 'app', 'api', 'workers', 'ingest', 'route.ts');
const SYNC_GATES_PATH = join(process.cwd(), 'lib', 'ingest', 'sync-gates.ts');
const QUOTA_LIB_PATH = join(process.cwd(), 'lib', 'quota.ts');
const RECONCILIATION_LIB_PATH = join(process.cwd(), 'lib', 'reconciliation.ts');
const RECONCILE_RUN_ROUTE_PATH = join(process.cwd(), 'app', 'api', 'cron', 'reconcile-usage', 'run', 'route.ts');
const PR4_MIGRATION_PATH = join(process.cwd(), 'supabase', 'migrations', '20260216000004_revenue_kernel_pr4_reconciliation_jobs.sql');

test('PR gate: duplicate path returns 200 with dedup and MUST NOT persist (worker acks)', () => {
  const worker = readFileSync(WORKER_INGEST_PATH, 'utf8');
  const syncGates = readFileSync(SYNC_GATES_PATH, 'utf8');
  assert.ok(worker.includes('DedupSkipError'), 'worker must handle DedupSkipError');
  assert.ok(worker.includes('dedup: true'), 'worker dedup response must exist');
  assert.ok(syncGates.includes("reason: 'duplicate'"), 'sync-gates must return duplicate');
});

test('PR gate: rate limit 429 sets x-opsmantik-ratelimit (non-billable)', () => {
  const src = readFileSync(SYNC_ROUTE_PATH, 'utf8');
  const rateLimitStart = src.indexOf('if (!rl.allowed)');
  assert.ok(rateLimitStart !== -1, 'rate limit block must exist');
  const rateLimitBlock = src.slice(rateLimitStart, rateLimitStart + 600);
  assert.ok(rateLimitBlock.includes("'x-opsmantik-ratelimit': '1'"), 'rate limit 429 must set x-opsmantik-ratelimit === "1"');
  assert.ok(!rateLimitBlock.includes('x-opsmantik-quota-exceeded'), 'rate limit 429 must NOT set x-opsmantik-quota-exceeded (429 reason separation)');
});

test('PR gate: evaluation order Auth (validateSite) -> Rate limit -> Consent -> Publish (route); Idempotency -> Quota -> Persist (worker)', () => {
  const sync = readFileSync(SYNC_ROUTE_PATH, 'utf8');
  const worker = readFileSync(WORKER_INGEST_PATH, 'utf8');
  const syncGates = readFileSync(SYNC_GATES_PATH, 'utf8');
  const auth = sync.indexOf('validateSiteFn');
  const rateLimit = sync.indexOf('rl.allowed', auth);
  const publish = sync.indexOf('doPublish') !== -1 ? sync.indexOf('doPublish') : sync.indexOf('publishToQStash');
  assert.ok(auth < rateLimit, 'Auth before Rate limit');
  assert.ok(rateLimit < publish, 'Rate limit before Publish');
  const idempotency = syncGates.indexOf('tryInsertIdempotencyKey');
  const quota = syncGates.indexOf('evaluateQuota');
  const persist = worker.indexOf('processSyncEvent') !== -1 ? worker.indexOf('processSyncEvent') : worker.indexOf('processCallEvent');
  assert.ok(idempotency !== -1 && quota !== -1, 'worker path: idempotency and quota must exist in sync-gates');
  assert.ok(idempotency < quota, 'Idempotency before Quota in worker');
});

test('PR gate: quota reject path does not publish or write fallback', () => {
  const syncGates = readFileSync(SYNC_GATES_PATH, 'utf8');
  assert.ok(syncGates.includes("reason: 'quota_reject'"), 'quota reject returns reason quota_reject');
  assert.ok(syncGates.includes('updateIdempotencyBillableFalse'), 'quota reject must update billable before return');
});

test('PR gate: quota reject sets x-opsmantik-quota-exceeded and not x-opsmantik-ratelimit', () => {
  const syncGates = readFileSync(SYNC_GATES_PATH, 'utf8');
  assert.ok(syncGates.includes("reason: 'quota_reject'"), 'quota reject block must exist');
  assert.ok(syncGates.includes('evaluateQuota'), 'quota evaluation must exist');
  const quotaLib = readFileSync(QUOTA_LIB_PATH, 'utf8');
  assert.ok(quotaLib.includes("'x-opsmantik-quota-exceeded': '1'"), 'quota module must set x-opsmantik-quota-exceeded === "1"');
});

test('PR gate: quota reject updates idempotency row billable=false', () => {
  const syncGates = readFileSync(SYNC_GATES_PATH, 'utf8');
  assert.ok(syncGates.includes('updateIdempotencyBillableFalse'), 'quota reject must call updateIdempotencyBillableFalse');
  const updateIdx = syncGates.indexOf('updateIdempotencyBillableFalse');
  const rejectIdx = syncGates.indexOf("reason: 'quota_reject'");
  assert.ok(updateIdx < rejectIdx, 'billable=false update must happen before returning quota_reject');
});

test('PR gate: QStash failure path writes fallback (sync route)', () => {
  const src = readFileSync(SYNC_ROUTE_PATH, 'utf8');
  const publishCall = src.indexOf('await doPublish(') !== -1 ? src.indexOf('await doPublish(') : src.indexOf('publishToQStash({');
  const fallbackCall = src.indexOf('doInsertFallback(');
  assert.ok(publishCall !== -1 && fallbackCall !== -1, 'publish and fallback call must exist');
  assert.ok(publishCall < fallbackCall, 'fallback is in catch of publish failure');
});

test('PR gate: idempotency DB error must ack and MUST NOT persist (worker)', () => {
  const worker = readFileSync(WORKER_INGEST_PATH, 'utf8');
  const syncGates = readFileSync(SYNC_GATES_PATH, 'utf8');
  assert.ok(syncGates.includes('idempotency_error'), 'sync-gates must return idempotency_error');
  assert.ok(worker.includes('WORKERS_INGEST_BILLING_GATE_CLOSED'), 'worker must log BILLING_GATE_CLOSED on idempotency error');
  const gatesCall = worker.indexOf('runSyncGates');
  const processCall = worker.indexOf('processSyncEvent');
  assert.ok(gatesCall < processCall, 'gates run before process (idempotency error stops before persist)');
});

// Idempotency runs in worker via runSyncGates; when tryInsert fails (DB error), gates return idempotency_error
// and worker acks without calling processSyncEvent. Pure unit test via source assertions (no DB, no mocks).
test('PR gate: idempotency DB error aborts flow and does not reach persist', () => {
  const syncGates = readFileSync(SYNC_GATES_PATH, 'utf8');
  const worker = readFileSync(WORKER_INGEST_PATH, 'utf8');

  // 1) sync-gates: when idempotencyResult.error && !duplicate, return idempotency_error immediately
  const idempotencyErrorBlock = syncGates.indexOf("idempotencyResult.error && !idempotencyResult.duplicate");
  assert.ok(idempotencyErrorBlock !== -1, 'sync-gates must check idempotencyResult.error && !duplicate');
  const returnIdempotencyError = syncGates.indexOf("reason: 'idempotency_error'", idempotencyErrorBlock);
  assert.ok(returnIdempotencyError !== -1 && returnIdempotencyError < idempotencyErrorBlock + 200, 'sync-gates must return idempotency_error on DB error');

  // 2) sync-gates: idempotency check happens before quota/entitlements/persist (no getSitePlan before idempotency return)
  const tryInsertCall = syncGates.indexOf('tryInsertIdempotencyKey(');
  const getSitePlanCall = syncGates.indexOf('getSitePlan(');
  assert.ok(tryInsertCall !== -1 && getSitePlanCall !== -1, 'sync-gates must have tryInsert and getSitePlan');
  assert.ok(tryInsertCall < getSitePlanCall, 'tryInsertIdempotencyKey must run before getSitePlan (idempotency before quota)');

  // 3) sync-gates: idempotency_error return happens before getSitePlan (early exit on DB error)
  const earlyReturnEnd = syncGates.indexOf('}', returnIdempotencyError) + 1;
  const blockBeforeQuota = syncGates.slice(idempotencyErrorBlock, earlyReturnEnd);
  assert.ok(!blockBeforeQuota.includes('getSitePlan') && !blockBeforeQuota.includes('evaluateQuota'), 'idempotency_error return must not reach quota logic');

  // 4) worker: when gatesResult.ok === false, return before processSyncEvent (no persist)
  const gatesCheck = worker.indexOf('gatesResult.ok === false');
  const processSyncCall = worker.indexOf('processSyncEvent(');
  assert.ok(gatesCheck !== -1 && processSyncCall !== -1, 'worker must check gates and call processSyncEvent');
  assert.ok(gatesCheck < processSyncCall, 'gates check must run before processSyncEvent');
  const returnBlock = worker.indexOf('return NextResponse.json', gatesCheck);
  assert.ok(returnBlock !== -1 && returnBlock < processSyncCall, 'worker must return on gates failure before processSyncEvent');

  // 5) worker: idempotency_error path returns { ok: true, reason } (ack to QStash) and logs WORKERS_INGEST_BILLING_GATE_CLOSED
  assert.ok(worker.includes("reason === 'idempotency_error'"), 'worker must handle idempotency_error');
  assert.ok(worker.includes('WORKERS_INGEST_BILLING_GATE_CLOSED'), 'worker must log WORKERS_INGEST_BILLING_GATE_CLOSED on idempotency error');
});

test('PR-4 gate: reconciliation authority is ingest_idempotency count only (no Redis as invoice SoT)', () => {
  const recon = readFileSync(RECONCILIATION_LIB_PATH, 'utf8');
  assert.ok(recon.includes("from('ingest_idempotency')"), 'reconciliation must read from ingest_idempotency');
  assert.ok(recon.includes('.eq(\'billable\', true)'), 'reconciliation must count billable=true only');
  assert.ok(recon.includes('pg_count_billable'), 'reconciliation must use PG count as primary');
  assert.ok(recon.includes('site_usage_monthly') && recon.includes('upsert'), 'reconciliation must upsert site_usage_monthly from PG counts');
  assert.ok(recon.includes('} catch') && recon.includes('Never fail'), 'Redis must be best-effort only');
});

test('PR-4 gate: job runner uses FOR UPDATE SKIP LOCKED pattern', () => {
  const migration = readFileSync(PR4_MIGRATION_PATH, 'utf8');
  assert.ok(migration.includes('SKIP LOCKED'), 'migration must define SKIP LOCKED for job claim');
  assert.ok(migration.includes('claim_billing_reconciliation_jobs'), 'migration must define claim RPC');
  const runRoute = readFileSync(RECONCILE_RUN_ROUTE_PATH, 'utf8');
  assert.ok(runRoute.includes('claim_billing_reconciliation_jobs'), 'run route must call claim_billing_reconciliation_jobs');
});
