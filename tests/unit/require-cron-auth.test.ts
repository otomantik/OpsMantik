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

test('requireCronAuth: x-vercel-cron truthy (non-1) => forbidden', async () => {
  const req = requestWithHeaders({ 'x-vercel-cron': 'true', 'x-vercel-id': 'fra1::abc123' });
  const result = requireCronAuth(req);
  assert.notEqual(result, null);
  assert.equal(result!.status, 403);
  const text = await result!.text();
  const json = JSON.parse(text);
  assert.equal(json.code, 'CRON_FORBIDDEN');
});

test('requireCronAuth: x-vercel-cron=1 without x-vercel-id => forbidden', async () => {
  const req = requestWithHeaders({ 'x-vercel-cron': '1' });
  const result = requireCronAuth(req);
  assert.notEqual(result, null);
  assert.equal(result!.status, 403);
  const text = await result!.text();
  const json = JSON.parse(text);
  assert.equal(json.code, 'CRON_FORBIDDEN');
});

test('requireCronAuth: non-production allows trusted Vercel provenance without bearer', () => {
  const envKeys = ['NODE_ENV', 'CRON_SECRET', 'CRON_AUTH_MODE'];
  const saved = stashEnv(envKeys);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'development';
    delete process.env.CRON_SECRET;
    delete process.env.CRON_AUTH_MODE;
    const req = requestWithHeaders({ 'x-vercel-cron': '1', 'x-vercel-id': 'fra1::abc123' });
    const result = requireCronAuth(req);
    assert.equal(result, null);
  } finally {
    restoreEnv(saved);
  }
});

test('requireCronAuth: non-production allows valid bearer for manual runs', () => {
  const envKeys = ['NODE_ENV', 'CRON_SECRET', 'CRON_AUTH_MODE'];
  const saved = stashEnv(envKeys);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'development';
    process.env.CRON_SECRET = CRON_SECRET;
    delete process.env.CRON_AUTH_MODE;
    const req = requestWithHeaders({ authorization: `Bearer ${CRON_SECRET}` });
    const result = requireCronAuth(req);
    assert.equal(result, null);
  } finally {
    restoreEnv(saved);
  }
});

test('requireCronAuth: no x-vercel-cron, invalid bearer => 403 with code CRON_FORBIDDEN', async () => {
  const envKeys = ['NODE_ENV', 'CRON_SECRET'];
  const saved = stashEnv(envKeys);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'development';
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

test('requireCronAuth: production rejects Vercel provenance without bearer', async () => {
  const envKeys = ['CRON_SECRET', 'NODE_ENV', 'CRON_AUTH_MODE'];
  const saved = stashEnv(envKeys);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    delete process.env.CRON_AUTH_MODE;
    const req = requestWithHeaders({ 'x-vercel-cron': '1', 'x-vercel-id': 'fra1::abc123' });
    const result = requireCronAuth(req);
    assert.notEqual(result, null, 'production must require bearer in addition to Vercel provenance');
    assert.equal(result!.status, 403);
    const text = await result!.text();
    const json = JSON.parse(text);
    assert.equal(json.code, 'CRON_FORBIDDEN');
  } finally {
    restoreEnv(saved);
  }
});

test('requireCronAuth: production rejects bearer without Vercel provenance in hybrid mode', async () => {
  const envKeys = ['CRON_SECRET', 'NODE_ENV', 'CRON_AUTH_MODE'];
  const saved = stashEnv(envKeys);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    const req = requestWithHeaders({ authorization: `Bearer ${CRON_SECRET}` });
    const result = requireCronAuth(req);
    assert.notEqual(result, null);
    assert.equal(result!.status, 403);
  } finally {
    restoreEnv(saved);
  }
});

test('requireCronAuth: production allows dual-key Vercel provenance plus bearer', () => {
  const envKeys = ['CRON_SECRET', 'NODE_ENV', 'CRON_AUTH_MODE'];
  const saved = stashEnv(envKeys);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    delete process.env.CRON_AUTH_MODE;
    const req = requestWithHeaders({
      'x-vercel-cron': '1',
      'x-vercel-id': 'fra1::abc123',
      authorization: `Bearer ${CRON_SECRET}`,
    });
    const result = requireCronAuth(req);
    assert.equal(result, null);
  } finally {
    restoreEnv(saved);
  }
});

test('requireCronAuth: production rejects placeholder secret even with dual-key headers', async () => {
  const envKeys = ['CRON_SECRET', 'NODE_ENV', 'CRON_AUTH_MODE'];
  const saved = stashEnv(envKeys);
  try {
    process.env.CRON_SECRET = 'changeme';
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    delete process.env.CRON_AUTH_MODE;
    const req = requestWithHeaders({
      'x-vercel-cron': '1',
      'x-vercel-id': 'fra1::abc123',
      authorization: 'Bearer changeme',
    });
    const result = requireCronAuth(req);
    assert.notEqual(result, null);
    assert.equal(result!.status, 403);
  } finally {
    restoreEnv(saved);
  }
});

test('requireCronAuth: bearer_only mode rejects trusted vercel headers', async () => {
  const envKeys = ['CRON_SECRET', 'CRON_AUTH_MODE', 'NODE_ENV'];
  const saved = stashEnv(envKeys);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.CRON_AUTH_MODE = 'bearer_only';
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    const req = requestWithHeaders({ 'x-vercel-cron': '1', 'x-vercel-id': 'fra1::abc123' });
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

test('requireCronAuth: bearer_only mode allows valid bearer in production', () => {
  const envKeys = ['CRON_SECRET', 'CRON_AUTH_MODE', 'NODE_ENV'];
  const saved = stashEnv(envKeys);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.CRON_AUTH_MODE = 'bearer_only';
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    const req = requestWithHeaders({ authorization: `Bearer ${CRON_SECRET}` });
    const result = requireCronAuth(req);
    assert.equal(result, null);
  } finally {
    restoreEnv(saved);
  }
});
