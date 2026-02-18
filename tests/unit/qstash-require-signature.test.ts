/**
 * QStash signature guard: prod must never accept unsigned requests; dev bypass only with explicit flag.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest, NextResponse } from 'next/server';
import { requireQstashSignature } from '@/lib/qstash/require-signature';

const FAKE_KEY = 'sig_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

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

test('requireQstashSignature: prod + missing keys => 503', async () => {
  const envKeys = ['NODE_ENV', 'VERCEL_ENV', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'ALLOW_INSECURE_DEV_WORKER'];
  const saved = stashEnv(envKeys);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    delete process.env.ALLOW_INSECURE_DEV_WORKER;

    const handler = async () => NextResponse.json({ ok: true });
    const wrapped = requireQstashSignature(handler);
    const req = new NextRequest('http://localhost:3000/api/sync/worker', { method: 'POST', body: '{}' });
    const res = await wrapped(req);

    assert.equal(res.status, 503, 'Missing keys in prod must return 503');
    const body = await res.json();
    assert.equal(body?.code, 'QSTASH_KEYS_MISSING');
  } finally {
    restoreEnv(saved);
  }
});

test('requireQstashSignature: prod + missing signature header => 403 (code missing)', async () => {
  const envKeys = ['NODE_ENV', 'VERCEL_ENV', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'ALLOW_INSECURE_DEV_WORKER'];
  const saved = stashEnv(envKeys);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.QSTASH_CURRENT_SIGNING_KEY = FAKE_KEY;
    process.env.QSTASH_NEXT_SIGNING_KEY = FAKE_KEY;
    delete process.env.ALLOW_INSECURE_DEV_WORKER;

    const handler = async () => NextResponse.json({ ok: true });
    const wrapped = requireQstashSignature(handler);
    const req = new NextRequest('http://localhost:3000/api/sync/worker', {
      method: 'POST',
      body: '{}',
      // No upstash-signature header -> 403 with QSTASH_SIGNATURE_MISSING
    });
    const res = await wrapped(req);

    assert.equal(res.status, 403, 'Missing signature must return 403');
    const body = await res.json();
    assert.equal(body?.code, 'QSTASH_SIGNATURE_MISSING');
    assert.equal(body?.error, 'forbidden');
  } finally {
    restoreEnv(saved);
  }
});

test('requireQstashSignature: prod + invalid signature header "fake" => 403 (code invalid), NOT 500', async () => {
  const envKeys = ['NODE_ENV', 'VERCEL_ENV', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'ALLOW_INSECURE_DEV_WORKER'];
  const saved = stashEnv(envKeys);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.QSTASH_CURRENT_SIGNING_KEY = FAKE_KEY;
    process.env.QSTASH_NEXT_SIGNING_KEY = FAKE_KEY;
    delete process.env.ALLOW_INSECURE_DEV_WORKER;

    const handler = async () => NextResponse.json({ ok: true });
    const wrapped = requireQstashSignature(handler);
    const req = new NextRequest('http://localhost:3000/api/sync/worker', {
      method: 'POST',
      body: '{}',
      headers: { 'Upstash-Signature': 'fake' },
    });
    const res = await wrapped(req);

    assert.equal(res.status, 403, 'Invalid signature must return 403, not 500');
    assert.notEqual(res.status, 500, 'Must not return 500 for invalid signature');
    const body = await res.json();
    assert.equal(body?.code, 'QSTASH_SIGNATURE_INVALID');
    assert.equal(body?.error, 'forbidden');
  } finally {
    restoreEnv(saved);
  }
});

test('requireQstashSignature: dev + ALLOW_INSECURE_DEV_WORKER=true => handler runs', async () => {
  const envKeys = ['NODE_ENV', 'VERCEL_ENV', 'QSTASH_CURRENT_SIGNING_KEY', 'ALLOW_INSECURE_DEV_WORKER'];
  const saved = stashEnv(envKeys);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'development';
    delete process.env.VERCEL_ENV;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    process.env.ALLOW_INSECURE_DEV_WORKER = 'true';

    const handler = async () => NextResponse.json({ ok: true, dev: true });
    const wrapped = requireQstashSignature(handler);
    const req = new NextRequest('http://localhost:3000/api/sync/worker', { method: 'POST', body: '{}' });
    const res = await wrapped(req);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body?.ok, true);
    assert.equal(body?.dev, true);
  } finally {
    restoreEnv(saved);
  }
});

test('requireQstashSignature: dev without allow flag + missing keys => 503', async () => {
  const envKeys = ['NODE_ENV', 'VERCEL_ENV', 'QSTASH_CURRENT_SIGNING_KEY', 'ALLOW_INSECURE_DEV_WORKER'];
  const saved = stashEnv(envKeys);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'development';
    delete process.env.VERCEL_ENV;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.ALLOW_INSECURE_DEV_WORKER;

    const handler = async () => NextResponse.json({ ok: true });
    const wrapped = requireQstashSignature(handler);
    const req = new NextRequest('http://localhost:3000/api/sync/worker', { method: 'POST', body: '{}' });
    const res = await wrapped(req);

    assert.equal(res.status, 503, 'Without allow flag, missing keys must still 503');
  } finally {
    restoreEnv(saved);
  }
});
