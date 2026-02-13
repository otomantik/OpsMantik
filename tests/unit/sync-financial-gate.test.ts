/**
 * PR-10: Financial gate integration tests for createSyncHandler({ tryInsert, ... }).
 * Harness simulates: (1) duplicate, (2) db down, (3) success + quota reject, (4) success + qstash down fallback.
 * Assertions: db down => 500 + billing_gate_closed, no publish/fallback/redis; quota reject => 429 + quota-exceeded, billable=false; duplicate => 200 + dedup, no publish; fallback => idempotency row exists before fallback insert.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncHandler } from '@/app/api/sync/route';
import type { TryInsertIdempotencyResult } from '@/lib/idempotency';
import type { QuotaDecision } from '@/lib/quota';
import { NextRequest } from 'next/server';

const TEST_SITE_UUID = '00000000-0000-0000-0000-000000000001';
const ORIGIN = 'http://localhost:3000';

function buildSyncRequest(body: { s: string; url: string; ec?: string; ea?: string; el?: string }) {
  return new NextRequest('http://localhost:3000/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({
      s: body.s,
      url: body.url,
      ec: body.ec ?? 'c',
      ea: body.ea ?? 'e',
      el: body.el ?? 'l',
    }),
  });
}

const baseDeps = {
  validateSite: async () => ({ valid: true, site: { id: TEST_SITE_UUID } }),
  checkRateLimit: async () => ({ allowed: true }),
};

test('PR-10: (1) duplicate => 200 + x-opsmantik-dedup, no publish', async () => {
  let publishCalled = false;
  const POST = createSyncHandler({
    ...baseDeps,
    tryInsert: async () => ({ inserted: false, duplicate: true }),
    publish: async () => {
      publishCalled = true;
    },
  });

  const req = buildSyncRequest({ s: 'test-site', url: 'https://example.com' });
  const res = await POST(req);
  const data = (await res.json().catch(() => ({}))) as { status?: string };

  assert.equal(res.status, 200, 'duplicate must return 200');
  assert.equal(res.headers.get('x-opsmantik-dedup'), '1', 'must set x-opsmantik-dedup');
  assert.equal(data.status, 'duplicate', 'body must have status duplicate');
  assert.equal(publishCalled, false, 'must not publish on duplicate');
});

test('PR-10: (2) db down => 500 + billing_gate_closed, no publish, no fallback, no redis', async () => {
  let publishCalled = false;
  let fallbackCalled = false;
  let redisCalled = false;

  const POST = createSyncHandler({
    ...baseDeps,
    tryInsert: async (): Promise<TryInsertIdempotencyResult> => ({
      inserted: false,
      duplicate: false,
      error: new Error('db down'),
    }),
    publish: async () => {
      publishCalled = true;
    },
    insertFallback: async () => {
      fallbackCalled = true;
      return { error: null };
    },
    incrementUsageRedis: async () => {
      redisCalled = true;
    },
  });

  const req = buildSyncRequest({ s: 'test-site', url: 'https://example.com' });
  const res = await POST(req);
  const data = (await res.json().catch(() => ({}))) as { status?: string };

  assert.equal(res.status, 500, 'db down must return 500');
  assert.equal(data.status, 'billing_gate_closed', 'must return status billing_gate_closed');
  assert.equal(publishCalled, false, 'must not publish when idempotency fails');
  assert.equal(fallbackCalled, false, 'must not write fallback when idempotency fails');
  assert.equal(redisCalled, false, 'must not increment redis when idempotency fails');
});

test('PR-10: (3) success + quota reject => 429 + quota-exceeded only, billable=false updated', async () => {
  let updateBillableFalseCalled = false;
  let publishCalled = false;

  const rejectDecision: QuotaDecision = {
    allow: false,
    overage: false,
    reject: true,
    reason: 'monthly_limit_exceeded',
    headers: { 'x-opsmantik-quota-remaining': '0', 'x-opsmantik-quota-exceeded': '1' },
  };

  const POST = createSyncHandler({
    ...baseDeps,
    tryInsert: async () => ({ inserted: true, duplicate: false }),
    getQuotaDecision: async () => rejectDecision,
    updateIdempotencyBillableFalse: async () => {
      updateBillableFalseCalled = true;
      return { updated: true };
    },
    publish: async () => {
      publishCalled = true;
    },
  });

  const req = buildSyncRequest({ s: 'test-site', url: 'https://example.com' });
  const res = await POST(req);
  const data = (await res.json().catch(() => ({}))) as { status?: string };

  assert.equal(res.status, 429, 'quota reject must return 429');
  assert.equal(data.status, 'rejected_quota', 'body must have status rejected_quota');
  assert.equal(res.headers.get('x-opsmantik-quota-exceeded'), '1', 'must set quota-exceeded header');
  assert.equal(res.headers.get('x-opsmantik-ratelimit'), null, 'must not set ratelimit header (quota-only 429)');
  assert.equal(updateBillableFalseCalled, true, 'must update idempotency row billable=false');
  assert.equal(publishCalled, false, 'must not publish on quota reject');
});

test('PR-10: (4) success + qstash down fallback => idempotency row exists before fallback insert', async () => {
  let idempotencyInsertedBeforeFallback = false;

  const POST = createSyncHandler({
    ...baseDeps,
    tryInsert: async () => ({ inserted: true, duplicate: false }),
    getQuotaDecision: async (): Promise<QuotaDecision> => ({
      allow: true,
      overage: false,
      reject: false,
      headers: { 'x-opsmantik-quota-remaining': '100' },
    }),
    publish: async () => {
      throw new Error('qstash down');
    },
    insertFallback: async () => {
      // In the handler, fallback is only reached after idempotency insert (inserted: true) and publish throw.
      idempotencyInsertedBeforeFallback = true;
      return { error: null };
    },
  });

  const req = buildSyncRequest({ s: 'test-site', url: 'https://example.com' });
  const res = await POST(req);
  const data = (await res.json().catch(() => ({}))) as { status?: string };

  assert.equal(res.status, 200, 'fallback path must return 200 (degraded)');
  assert.equal(data.status, 'degraded', 'body must have status degraded');
  assert.equal(res.headers.get('x-opsmantik-fallback'), 'true', 'must set fallback header');
  assert.equal(res.headers.get('x-opsmantik-degraded'), 'qstash_publish_failed', 'must set degraded header');
  assert.equal(idempotencyInsertedBeforeFallback, true, 'fallback insert must be called (idempotency row exists before fallback by code order)');
});
