import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest, NextResponse } from 'next/server';
import { requireQstashSignature } from '@/lib/qstash/require-signature';
import { processOutboxWorkerHandler } from '@/app/api/workers/oci/process-outbox/route';

const FAKE_KEY = 'sig_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const WORKER_URL = 'http://localhost:3000/api/workers/oci/process-outbox';

function stashEnv(keys: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) out[k] = process.env[k];
  return out;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of Object.keys(snapshot)) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

async function runWithHeaders(headers: Record<string, string>) {
  const wrapped = requireQstashSignature(async () => NextResponse.json({ ok: true }));
  const req = new NextRequest(WORKER_URL, { method: 'POST', body: '{}', headers });
  return wrapped(req);
}

test('process-outbox worker auth: missing auth is rejected (403)', async () => {
  const saved = stashEnv(['NODE_ENV', 'VERCEL_ENV', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'CRON_SECRET']);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.QSTASH_CURRENT_SIGNING_KEY = FAKE_KEY;
    process.env.QSTASH_NEXT_SIGNING_KEY = FAKE_KEY;
    process.env.CRON_SECRET = 'worker-secret';

    const res = await runWithHeaders({});
    assert.equal(res.status, 403);
  } finally {
    restoreEnv(saved);
  }
});

test('process-outbox worker auth: wrong bearer is rejected (403)', async () => {
  const saved = stashEnv(['NODE_ENV', 'VERCEL_ENV', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'CRON_SECRET']);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.QSTASH_CURRENT_SIGNING_KEY = FAKE_KEY;
    process.env.QSTASH_NEXT_SIGNING_KEY = FAKE_KEY;
    process.env.CRON_SECRET = 'worker-secret';

    const res = await runWithHeaders({
      authorization: 'Bearer wrong-secret',
      'x-opsmantik-internal-worker': '1',
    });
    assert.equal(res.status, 403);
  } finally {
    restoreEnv(saved);
  }
});

test('process-outbox worker auth: missing internal header is rejected (403)', async () => {
  const saved = stashEnv(['NODE_ENV', 'VERCEL_ENV', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'CRON_SECRET']);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.QSTASH_CURRENT_SIGNING_KEY = FAKE_KEY;
    process.env.QSTASH_NEXT_SIGNING_KEY = FAKE_KEY;
    process.env.CRON_SECRET = 'worker-secret';

    const res = await runWithHeaders({
      authorization: 'Bearer worker-secret',
    });
    assert.equal(res.status, 403);
  } finally {
    restoreEnv(saved);
  }
});

test('process-outbox worker auth: valid secret + internal header is accepted (200)', async () => {
  const saved = stashEnv(['NODE_ENV', 'VERCEL_ENV', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'CRON_SECRET']);
  try {
    (process.env as NodeJS.ProcessEnv & { NODE_ENV?: string }).NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.QSTASH_CURRENT_SIGNING_KEY = FAKE_KEY;
    process.env.QSTASH_NEXT_SIGNING_KEY = FAKE_KEY;
    process.env.CRON_SECRET = 'worker-secret';

    const res = await runWithHeaders({
      authorization: 'Bearer worker-secret',
      'x-opsmantik-internal-worker': '1',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body?.ok, true);
  } finally {
    restoreEnv(saved);
  }
});

test('process-outbox worker handler returns stable response shape', async () => {
  const req = new NextRequest(WORKER_URL, {
    method: 'POST',
    body: '{}',
    headers: {
      authorization: 'Bearer ignored-for-handler-test',
      'x-opsmantik-internal-worker': '1',
    },
  });

  const res = await processOutboxWorkerHandler(req, async () => ({
    ok: true,
    claimed: 3,
    processed: 2,
    failed: 1,
    message: 'no_pending_events',
    errors: ['x'],
  }));

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.claimed, 3);
  assert.equal(body.processed, 2);
  assert.equal(body.failed, 1);
  assert.equal(body.message, 'no_pending_events');
  assert.deepEqual(body.errors, ['x']);
});
