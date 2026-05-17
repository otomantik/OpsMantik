import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

import { GET as getTestThrow } from '@/app/api/watchtower/test-throw/route';
import { POST as postCreateTestSite } from '@/app/api/create-test-site/route';
import { GET as getTestOci } from '@/app/api/test-oci/route';
import { POST as postRealtimeSignal } from '@/app/api/debug/realtime-signal/route';

const ROOT = process.cwd();

const DEV_ROUTE_FILES = [
  'app/api/debug/realtime-signal/route.ts',
  'app/api/create-test-site/route.ts',
  'app/api/test-oci/route.ts',
  'app/api/watchtower/test-throw/route.ts',
] as const;

type ProdEnvPatch = Partial<Record<'NODE_ENV' | 'VERCEL_ENV' | 'OCI_ENV', string>>;

function withProdEnv(patch: ProdEnvPatch, fn: () => Promise<void> | void): Promise<void> | void {
  const keys = ['NODE_ENV', 'VERCEL_ENV', 'OCI_ENV'] as const;
  const prev: Partial<Record<(typeof keys)[number], string | undefined>> = {};
  for (const key of keys) {
    prev[key] = process.env[key];
    if (patch[key] !== undefined) process.env[key] = patch[key];
    else delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      const v = prev[key];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
  }
}

function clearProdMarkers(): void {
  delete process.env.NODE_ENV;
  delete process.env.VERCEL_ENV;
  delete process.env.OCI_ENV;
}

async function expect404(handler: () => Promise<Response>): Promise<void> {
  const res = await handler();
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, 'Not found');
}

for (const file of DEV_ROUTE_FILES) {
  test(`static: ${file} imports production deployment SSOT`, () => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(
      src.includes('@/lib/env/is-production-deployment'),
      `${file} must import from lib/env/is-production-deployment`
    );
    assert.ok(
      src.includes('assertNotProductionDeployment') || src.includes('isProductionDeployment'),
      `${file} must call production deployment guard`
    );
  });
}

test('static: debug/realtime-signal has no raw NODE_ENV === production check', () => {
  const src = readFileSync(join(ROOT, 'app/api/debug/realtime-signal/route.ts'), 'utf8');
  assert.ok(!src.includes("NODE_ENV === 'production'"), 'must not use raw NODE_ENV production guard');
});

test('VERCEL_ENV=production => create-test-site 404', async () =>
  withProdEnv({ VERCEL_ENV: 'production' }, async () => {
    await expect404(() => postCreateTestSite());
  }));

test('OCI_ENV=production => create-test-site 404', async () =>
  withProdEnv({ OCI_ENV: 'production' }, async () => {
    await expect404(() => postCreateTestSite());
  }));

test('NODE_ENV=production => create-test-site 404', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    await expect404(() => postCreateTestSite());
  }));

test('VERCEL_ENV=production => test-oci 404', async () =>
  withProdEnv({ VERCEL_ENV: 'production' }, async () => {
    await expect404(() => getTestOci());
  }));

test('OCI_ENV=production => test-oci 404', async () =>
  withProdEnv({ OCI_ENV: 'production' }, async () => {
    await expect404(() => getTestOci());
  }));

test('NODE_ENV=production => test-oci 404', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    await expect404(() => getTestOci());
  }));

test('VERCEL_ENV=production => debug/realtime-signal 404', async () =>
  withProdEnv({ VERCEL_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/debug/realtime-signal', {
      method: 'POST',
      body: JSON.stringify({ siteId: '00000000-0000-0000-0000-000000000001' }),
    });
    await expect404(() => postRealtimeSignal(req));
  }));

test('OCI_ENV=production => debug/realtime-signal 404', async () =>
  withProdEnv({ OCI_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/debug/realtime-signal', {
      method: 'POST',
      body: '{}',
    });
    await expect404(() => postRealtimeSignal(req));
  }));

test('NODE_ENV=production => debug/realtime-signal 404', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/debug/realtime-signal', {
      method: 'POST',
      body: '{}',
    });
    await expect404(() => postRealtimeSignal(req));
  }));

test('production + WATCHTOWER_TEST_THROW=1 => test-throw 404 without throwing', async () =>
  withProdEnv({ VERCEL_ENV: 'production' }, async () => {
    const prev = process.env.WATCHTOWER_TEST_THROW;
    process.env.WATCHTOWER_TEST_THROW = '1';
    try {
      const req = new NextRequest('http://localhost/api/watchtower/test-throw');
      await expect404(async () => getTestThrow(req));
    } finally {
      if (prev === undefined) delete process.env.WATCHTOWER_TEST_THROW;
      else process.env.WATCHTOWER_TEST_THROW = prev;
    }
  }));

test('VERCEL_ENV=production => test-throw 404', async () =>
  withProdEnv({ VERCEL_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/watchtower/test-throw');
    await expect404(() => getTestThrow(req));
  }));

test('OCI_ENV=production => test-throw 404', async () =>
  withProdEnv({ OCI_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/watchtower/test-throw');
    await expect404(() => getTestThrow(req));
  }));

test('NODE_ENV=production => test-throw 404', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/watchtower/test-throw');
    await expect404(() => getTestThrow(req));
  }));

test('non-production: test-throw returns 200 when WATCHTOWER_TEST_THROW unset', async () =>
  withProdEnv({}, async () => {
    clearProdMarkers();
    const prev = process.env.WATCHTOWER_TEST_THROW;
    delete process.env.WATCHTOWER_TEST_THROW;
    try {
      const req = new NextRequest('http://localhost/api/watchtower/test-throw');
      const res = await getTestThrow(req);
      assert.equal(res.status, 200);
    } finally {
      if (prev === undefined) delete process.env.WATCHTOWER_TEST_THROW;
      else process.env.WATCHTOWER_TEST_THROW = prev;
    }
  }));
