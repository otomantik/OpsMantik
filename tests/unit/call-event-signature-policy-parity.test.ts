import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyCallEventSignaturePolicy } from '@/lib/security/call-event-signature-policy';

const ROOT = process.cwd();

function withEnv(next: () => Promise<void> | void, env: Partial<NodeJS.ProcessEnv>): Promise<void> | void {
  const prev: Partial<NodeJS.ProcessEnv> = {};
  for (const key of Object.keys(env)) {
    prev[key] = process.env[key];
    const nextValue = env[key];
    if (nextValue === undefined) delete process.env[key];
    else process.env[key] = nextValue;
  }
  try {
    return next();
  } finally {
    for (const key of Object.keys(env)) {
      const prevValue = prev[key];
      if (prevValue === undefined) delete process.env[key];
      else process.env[key] = prevValue;
    }
  }
}

function buildSignedHeaders(overrides?: Partial<Record<string, string>>): Headers {
  const ts = String(Math.floor(Date.now() / 1000));
  return new Headers({
    'x-ops-site-id': '550e8400-e29b-41d4-a716-446655440000',
    'x-ops-ts': ts,
    'x-ops-signature': 'a'.repeat(64),
    ...(overrides ?? {}),
  });
}

test('v1 and v2 routes both use shared call-event signature policy helper', () => {
  const v1 = readFileSync(join(ROOT, 'app', 'api', 'call-event', 'route.ts'), 'utf8');
  const v2 = readFileSync(join(ROOT, 'app', 'api', 'call-event', 'v2', 'route.ts'), 'utf8');

  assert.ok(v1.includes('verifyCallEventSignaturePolicy'), 'v1 must use shared signature policy');
  assert.ok(v2.includes('verifyCallEventSignaturePolicy'), 'v2 must use shared signature policy');
});

test('invalid signature is rejected (parity baseline for v1/v2)', async () => {
  const res = await verifyCallEventSignaturePolicy({
    headers: buildSignedHeaders({ 'x-ops-signature': 'bad' }),
    rawBody: '{"x":1}',
    route: '/api/call-event/v2',
    verifySignature: async () => ({ data: true, error: null }),
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 401);
});

test('verifier unavailable fails closed with 503 (applies equally to v1/v2)', async () => {
  const res = await verifyCallEventSignaturePolicy({
    headers: buildSignedHeaders(),
    rawBody: '{"x":1}',
    route: '/api/call-event',
    verifySignature: async () => ({
      data: null,
      error: { message: 'function verify_call_event_signature_v1 does not exist' },
    }),
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 503);
});

test('dev bypass works only with explicit flag in non-production', async () =>
  withEnv(async () => {
    const res = await verifyCallEventSignaturePolicy({
      headers: new Headers(),
      rawBody: '{}',
      route: '/api/call-event',
      verifySignature: async () => ({ data: null, error: { message: 'should not be called' } }),
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.bypassed, true);
  }, { CALL_EVENT_SIGNATURE_DEV_BYPASS: '1', NODE_ENV: 'development', VERCEL_ENV: 'preview', OCI_ENV: '' }));

test('dev bypass does not work in production', async () =>
  withEnv(async () => {
    const res = await verifyCallEventSignaturePolicy({
      headers: new Headers(),
      rawBody: '{}',
      route: '/api/call-event/v2',
      verifySignature: async () => ({ data: true, error: null }),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.status, 401);
  }, { CALL_EVENT_SIGNATURE_DEV_BYPASS: '1', NODE_ENV: 'production', VERCEL_ENV: 'production', OCI_ENV: 'production' }));
