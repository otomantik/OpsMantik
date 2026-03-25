import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createSyncHandler } from '@/app/api/sync/route';

const strictConfig = {
  ingest_strict_mode: false,
  ghost_geo_strict: false,
  traffic_debloat: false,
  page_view_10s_session_reuse: false,
  ingest_allow_preview_uas: false,
  referrer_allowlist: [],
  referrer_blocklist: [],
};

test('sync: intent-critical events use direct worker path', async () => {
  let publishCalls = 0;
  let workerCalls = 0;

  const handler = createSyncHandler({
    validateSite: async () => ({ valid: true, site: { id: '00000000-0000-0000-0000-000000000001' } }),
    checkRateLimit: async () => ({ allowed: true }),
    getSiteIngestConfig: async () => strictConfig,
    publish: async () => {
      publishCalls++;
    },
    executeWorker: async ({ body }) => {
      workerCalls++;
      const payload = body as Record<string, unknown>;
      assert.equal(payload.ea, 'phone_call');
    },
  });

  const req = new NextRequest('http://localhost:3000/api/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://example.com' },
    body: JSON.stringify({
      s: 'site_public_id',
      u: 'https://example.com/test?gclid=TEST',
      sid: 'sid-critical-1',
      sm: '2026-03-01',
      ec: 'conversion',
      ea: 'phone_call',
      el: 'tel:+905000000000',
      meta: { fp: 'fp-critical-1', gclid: 'TEST' },
      consent_scopes: ['analytics', 'marketing'],
    }),
  });

  const res = await handler(req);
  assert.equal(res.status, 202);
  assert.equal(workerCalls, 1, 'critical event should go through direct worker');
  assert.equal(publishCalls, 0, 'critical event should bypass publish queue');
  assert.equal(res.headers.get('x-opsmantik-direct-worker-critical'), '1');
});

test('sync: non-critical events keep publish queue path', async () => {
  let publishCalls = 0;
  let workerCalls = 0;

  const handler = createSyncHandler({
    validateSite: async () => ({ valid: true, site: { id: '00000000-0000-0000-0000-000000000001' } }),
    checkRateLimit: async () => ({ allowed: true }),
    getSiteIngestConfig: async () => strictConfig,
    publish: async ({ body }) => {
      publishCalls++;
      const payload = body as Record<string, unknown>;
      assert.equal(payload.ea, 'scroll_depth');
    },
    executeWorker: async () => {
      workerCalls++;
    },
  });

  const req = new NextRequest('http://localhost:3000/api/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://example.com' },
    body: JSON.stringify({
      s: 'site_public_id',
      u: 'https://example.com/page',
      sid: 'sid-normal-1',
      sm: '2026-03-01',
      ec: 'interaction',
      ea: 'scroll_depth',
      el: '50%',
      meta: { fp: 'fp-normal-1' },
      consent_scopes: ['analytics'],
    }),
  });

  const res = await handler(req);
  assert.equal(res.status, 202);
  assert.equal(publishCalls, 1, 'non-critical event should use publish queue');
  assert.equal(workerCalls, 0, 'non-critical event should not use direct worker');
  assert.equal(res.headers.get('x-opsmantik-direct-worker-critical'), null);
});
