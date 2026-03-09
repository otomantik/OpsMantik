/**
 * Legacy dispatch-conversions route is intentionally retired.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
test('GET /api/cron/dispatch-conversions returns explicit 410 retirement', async () => {
  const { GET } = await import('@/app/api/cron/dispatch-conversions/route');
  const req = new NextRequest('http://localhost/api/cron/dispatch-conversions', {
    method: 'GET',
  });
  const res = await GET(req);
  assert.equal(res.status, 410);
  const json = await res.json();
  assert.equal(json.code, 'LEGACY_CONVERSIONS_CRON_RETIRED');
});

test('POST /api/cron/dispatch-conversions returns explicit 410 retirement', async () => {
  const { POST } = await import('@/app/api/cron/dispatch-conversions/route');
  const req = new NextRequest('http://localhost/api/cron/dispatch-conversions', {
    method: 'POST',
  });
  const res = await POST(req);
  assert.equal(res.status, 410);
  const json = await res.json();
  assert.equal(json.code, 'LEGACY_CONVERSIONS_CRON_RETIRED');
});
