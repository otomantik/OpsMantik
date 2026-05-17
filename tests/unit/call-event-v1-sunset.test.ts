import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { OPTIONS, POST } from '@/app/api/call-event/route';

const ROOT = process.cwd();

test('static: v1 route is tombstone only (no legacy flag or v2 forward)', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'call-event', 'route.ts'), 'utf8');
  assert.ok(!src.includes('getRefactorFlags'), 'v1 must not use legacy rollback flag');
  assert.ok(!src.includes('postCallEventV2'), 'v1 must not forward to v2');
  assert.ok(!src.includes('LEGACY_ENDPOINTS_ENABLED'), 'v1 must not reference removed env');
  assert.ok(src.includes("status: 410"), 'v1 must always return 410 Gone');
});

test('POST /api/call-event always returns 410 Gone with canonical v2', async () => {
  const req = new NextRequest('http://localhost/api/call-event', {
    method: 'POST',
    headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    body: '{}',
  });
  const res = await POST(req);
  assert.equal(res.status, 410);
  const json = (await res.json()) as { error?: string; canonical?: string };
  assert.equal(json.error, 'gone');
  assert.equal(json.canonical, '/api/call-event/v2');
  assert.equal(res.headers.get('X-Ops-Deprecated'), '1');
  assert.equal(res.headers.get('X-Ops-Deprecated-Use'), '/api/call-event/v2');
});

test('OPTIONS /api/call-event includes deprecation headers', async () => {
  const req = new NextRequest('http://localhost/api/call-event', {
    method: 'OPTIONS',
    headers: { origin: 'https://example.com' },
  });
  const res = await OPTIONS(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Sunset'), '2026-05-10');
});
