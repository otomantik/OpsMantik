/**
 * Unit tests for requireCronAuth (cron auth helper only; no Next.js route imports).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';

const CRON_SECRET = 'test-cron-secret-123';

function stashEnv(keys: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) {
    out[k] = process.env[k];
  }
  return out;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const k of Object.keys(snapshot)) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/cron/watchtower', {
    method: 'GET',
    headers: new Headers(headers),
  });
}

test('requireCronAuth: x-vercel-cron=1 => allowed (null)', () => {
  const req = requestWithHeaders({ 'x-vercel-cron': '1' });
  const result = requireCronAuth(req);
  assert.equal(result, null);
});

test('requireCronAuth: x-vercel-cron truthy (non-1) => allowed (null)', () => {
  const req = requestWithHeaders({ 'x-vercel-cron': 'true' });
  const result = requireCronAuth(req);
  assert.equal(result, null);
});

test('requireCronAuth: no x-vercel-cron, valid Authorization Bearer CRON_SECRET => allowed', () => {
  const envKeys = ['CRON_SECRET'];
  const saved = stashEnv(envKeys);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    const req = requestWithHeaders({ authorization: `Bearer ${CRON_SECRET}` });
    const result = requireCronAuth(req);
    assert.equal(result, null);
  } finally {
    restoreEnv(saved);
  }
});

test('requireCronAuth: no x-vercel-cron, invalid bearer => 403 with code CRON_FORBIDDEN', async () => {
  const envKeys = ['CRON_SECRET'];
  const saved = stashEnv(envKeys);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    const req = requestWithHeaders({ authorization: 'Bearer wrong-token' });
    const result = requireCronAuth(req);
    assert.notEqual(result, null);
    assert.equal(result!.status, 403);
    const text = await result!.text();
    const json = JSON.parse(text);
    assert.equal(json.error, 'forbidden');
    assert.equal(json.code, 'CRON_FORBIDDEN');
  } finally {
    restoreEnv(saved);
  }
});

test('requireCronAuth: no x-vercel-cron, CRON_SECRET missing => 403', async () => {
  const envKeys = ['CRON_SECRET'];
  const saved = stashEnv(envKeys);
  try {
    delete process.env.CRON_SECRET;
    const req = requestWithHeaders({ authorization: 'Bearer anything' });
    const result = requireCronAuth(req);
    assert.notEqual(result, null);
    assert.equal(result!.status, 403);
    const text = await result!.text();
    const json = JSON.parse(text);
    assert.equal(json.code, 'CRON_FORBIDDEN');
  } finally {
    restoreEnv(saved);
  }
});
