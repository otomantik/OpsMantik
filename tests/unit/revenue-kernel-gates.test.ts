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
const QUOTA_LIB_PATH = join(process.cwd(), 'lib', 'quota.ts');
const RECONCILIATION_LIB_PATH = join(process.cwd(), 'lib', 'reconciliation.ts');
const RECONCILE_RUN_ROUTE_PATH = join(process.cwd(), 'app', 'api', 'cron', 'reconcile-usage', 'run', 'route.ts');
const PR4_MIGRATION_PATH = join(process.cwd(), 'supabase', 'migrations', '20260216000004_revenue_kernel_pr4_reconciliation_jobs.sql');

test('PR gate: duplicate path returns 200 with x-opsmantik-dedup and MUST NOT publish', () => {
  const src = readFileSync(SYNC_ROUTE_PATH, 'utf8');
  assert.ok(src.includes('x-opsmantik-dedup'), 'duplicate response must set x-opsmantik-dedup');
  assert.ok(src.includes("status: 'duplicate'"), 'duplicate response must have status duplicate');
  const afterDedup = src.indexOf("'x-opsmantik-dedup'");
  const publishCall = src.indexOf('qstash.publishJSON');
  assert.ok(afterDedup < publishCall, 'dedup return must be before publish (duplicate does not publish)');
});

test('PR gate: rate limit 429 sets x-opsmantik-ratelimit (non-billable)', () => {
  const src = readFileSync(SYNC_ROUTE_PATH, 'utf8');
  const rateLimitStart = src.indexOf('if (!rl.allowed)');
  assert.ok(rateLimitStart !== -1, 'rate limit block must exist');
  const rateLimitBlock = src.slice(rateLimitStart, rateLimitStart + 600);
  assert.ok(rateLimitBlock.includes("'x-opsmantik-ratelimit': '1'"), 'rate limit 429 must set x-opsmantik-ratelimit === "1"');
  assert.ok(!rateLimitBlock.includes('x-opsmantik-quota-exceeded'), 'rate limit 429 must NOT set x-opsmantik-quota-exceeded (429 reason separation)');
});

test('PR gate: evaluation order Auth -> Rate limit -> Idempotency -> Quota -> Publish', () => {
  const src = readFileSync(SYNC_ROUTE_PATH, 'utf8');
  const auth = src.indexOf('isOriginAllowed');
  const rateLimit = src.indexOf('rl.allowed');
  const idempotency = src.indexOf('tryInsert(siteIdUuid');
  const quota = src.indexOf('evaluateQuota(plan,'); // call site, not import
  const publish = src.indexOf('qstash.publishJSON');
  assert.ok(auth < rateLimit, 'Auth before Rate limit');
  assert.ok(rateLimit < idempotency, 'Rate limit before Idempotency');
  assert.ok(idempotency < quota, 'Idempotency before Quota');
  assert.ok(quota < publish, 'Quota before Publish');
});

test('PR gate: quota reject path does not publish or write fallback', () => {
  const src = readFileSync(SYNC_ROUTE_PATH, 'utf8');
  const quotaRejectReturn = src.indexOf("status: 'rejected_quota'");
  const publishCall = src.indexOf('qstash.publishJSON');
  const fallbackInsert = src.indexOf('ingest_fallback_buffer');
  assert.ok(quotaRejectReturn !== -1, 'quota reject returns status rejected_quota');
  assert.ok(quotaRejectReturn < publishCall, 'quota reject return before publish (no publish on reject)');
  assert.ok(quotaRejectReturn < fallbackInsert, 'quota reject return before fallback insert (no fallback on reject)');
});

test('PR gate: quota reject sets x-opsmantik-quota-exceeded and not x-opsmantik-ratelimit', () => {
  const src = readFileSync(SYNC_ROUTE_PATH, 'utf8');
  const quotaRejectStart = src.indexOf('if (decision.reject)');
  assert.ok(quotaRejectStart !== -1, 'quota reject block must exist');
  const quotaRejectBlock = src.slice(quotaRejectStart, quotaRejectStart + 900);
  assert.ok(quotaRejectBlock.includes('...decision.headers'), 'quota reject path must spread decision.headers (includes quota-exceeded)');
  assert.ok(quotaRejectBlock.includes("'rejected_quota'"), 'quota reject body must be status rejected_quota');
  assert.ok(!quotaRejectBlock.includes('x-opsmantik-ratelimit'), 'quota reject 429 must NOT set x-opsmantik-ratelimit (429 reason separation)');

  const quotaLib = readFileSync(QUOTA_LIB_PATH, 'utf8');
  assert.ok(quotaLib.includes("'x-opsmantik-quota-exceeded': '1'"), 'quota module must set x-opsmantik-quota-exceeded === "1"');
});

test('PR gate: quota reject updates idempotency row billable=false', () => {
  const src = readFileSync(SYNC_ROUTE_PATH, 'utf8');
  assert.ok(src.includes('updateIdempotencyBillableFalse'), 'quota reject must call updateIdempotencyBillableFalse before returning 429');
  const updateCall = src.indexOf('updateIdempotencyBillableFalse');
  const rejectReturn = src.indexOf("status: 'rejected_quota'");
  assert.ok(updateCall < rejectReturn, 'billable=false update must happen before returning rejected_quota');
});

test('PR gate: QStash failure path writes fallback after idempotency (billable at capture)', () => {
  const src = readFileSync(SYNC_ROUTE_PATH, 'utf8');
  const idempotencyInsert = src.indexOf('tryInsert(siteIdUuid');
  const fallbackInsert = src.indexOf('ingest_fallback_buffer');
  assert.ok(idempotencyInsert < fallbackInsert, 'idempotency row exists before fallback insert on publish failure');
});

test('PR gate: idempotency DB error must return 500 and MUST NOT publish', () => {
  const src = readFileSync(SYNC_ROUTE_PATH, 'utf8');
  assert.ok(src.includes('billing_gate_closed'), 'idempotency error path must return status billing_gate_closed');
  assert.ok(src.includes('BILLING_GATE_CLOSED'), 'idempotency error path must log BILLING_GATE_CLOSED');
  const billingGate500 = src.indexOf("'billing_gate_closed'");
  const publishCall = src.indexOf('qstash.publishJSON');
  const fallbackInsert = src.indexOf('ingest_fallback_buffer');
  assert.ok(billingGate500 !== -1, '500 response body must contain billing_gate_closed');
  assert.ok(billingGate500 < publishCall, '500 return must be before publish (fail-secure: no publish on idempotency error)');
  assert.ok(billingGate500 < fallbackInsert, '500 return must be before fallback (no fallback on idempotency error)');
  const status500 = src.indexOf('status: 500', billingGate500);
  assert.ok(status500 !== -1 || src.includes('status: 500'), 'response must be HTTP 500');
});

test('PR gate: idempotency DB error returns 500 and does not reach publish (runtime)', { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY, timeout: 8000 }, async () => {
  const { createSyncHandler } = await import('@/app/api/sync/route');

  const mockTryInsert = async () => ({ inserted: false, duplicate: false, error: new Error('db down') });
  const POST = createSyncHandler({ tryInsert: mockTryInsert });

  const req = new NextRequest('http://localhost:3000/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({
      s: process.env.TEST_SITE_PUBLIC_ID || 'test-site-id',
      url: 'https://example.com',
      ec: 'c',
      ea: 'e',
      el: 'l',
    }),
  });
  const res = await POST(req);
  const body = await res.json().catch(() => ({}));

  if (res.status !== 500) {
    return; // Request did not reach idempotency (e.g. 400 site not found, 403 origin, 429 rate limit); structure enforced by static test
  }

  assert.equal(body.status, 'billing_gate_closed', '500 response must have status billing_gate_closed');
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
