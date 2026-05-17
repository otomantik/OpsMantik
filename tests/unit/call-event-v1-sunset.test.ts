import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { OPTIONS, POST } from '@/app/api/call-event/route';

const LEGACY_KEY = 'LEGACY_ENDPOINTS_ENABLED';

function withLegacyEnv(enabled: boolean | undefined, fn: () => Promise<void>): Promise<void> {
  const prev = process.env[LEGACY_KEY];
  try {
    if (enabled === undefined) delete process.env[LEGACY_KEY];
    else process.env[LEGACY_KEY] = enabled ? 'true' : 'false';
    return fn();
  } finally {
    if (prev === undefined) delete process.env[LEGACY_KEY];
    else process.env[LEGACY_KEY] = prev;
  }
}

test('POST /api/call-event returns 410 Gone when legacy endpoints disabled (default)', async () =>
  withLegacyEnv(false, async () => {
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
    assert.equal(res.headers.get('Sunset'), '2026-05-10');
  }));

test('POST /api/call-event returns 410 when LEGACY_ENDPOINTS_ENABLED unset', async () =>
  withLegacyEnv(undefined, async () => {
    const req = new NextRequest('http://localhost/api/call-event', {
      method: 'POST',
      body: '{}',
    });
    const res = await POST(req);
    assert.equal(res.status, 410);
  }));

test('OPTIONS /api/call-event includes deprecation headers', async () => {
  const req = new NextRequest('http://localhost/api/call-event', {
    method: 'OPTIONS',
    headers: { origin: 'https://example.com' },
  });
  const res = await OPTIONS(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Ops-Deprecated'), '1');
  assert.equal(res.headers.get('X-Ops-Deprecated-Use'), '/api/call-event/v2');
  assert.equal(res.headers.get('Sunset'), '2026-05-10');
});
