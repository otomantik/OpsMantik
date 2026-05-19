import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

import { GET as getDashboardSpend } from '@/app/api/dashboard/spend/route';
import { POST as postGoogleSpendWebhook } from '@/app/api/webhooks/google-spend/route';
import { GET as getStatsRealtime } from '@/app/api/stats/realtime/route';
import { GET as getReportingDashboardStats } from '@/app/api/reporting/dashboard-stats/route';

const ROOT = process.cwd();

const CUT_01A_ROUTE_FILES = [
  'app/api/webhooks/google-spend/route.ts',
  'app/api/dashboard/spend/route.ts',
  'app/api/stats/realtime/route.ts',
  'app/api/reporting/dashboard-stats/route.ts',
] as const;

type ProdEnvPatch = Partial<Record<'NODE_ENV' | 'VERCEL_ENV' | 'OCI_ENV', string>>;

function withProdEnv(patch: ProdEnvPatch, fn: () => Promise<void> | void): Promise<void> | void {
  const keys = ['NODE_ENV', 'VERCEL_ENV', 'OCI_ENV', 'OUT_OF_CORE_SURFACES_STRICT'] as const;
  const prev: Partial<Record<(typeof keys)[number], string | undefined>> = {};
  for (const key of keys) {
    prev[key] = process.env[key];
    if (key === 'OUT_OF_CORE_SURFACES_STRICT') {
      delete process.env.OUT_OF_CORE_SURFACES_STRICT;
      continue;
    }
    if (patch[key as keyof ProdEnvPatch] !== undefined) {
      process.env[key] = patch[key as keyof ProdEnvPatch];
    } else {
      delete process.env[key];
    }
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
  delete process.env.OUT_OF_CORE_SURFACES_STRICT;
}

async function expect410(
  handler: () => Promise<Response>,
  surface: string,
): Promise<void> {
  const res = await handler();
  assert.equal(res.status, 410);
  const body = (await res.json()) as { error?: string; code?: string; surface?: string };
  assert.equal(body.error, 'gone');
  assert.equal(body.code, 'SURFACE_RETIRED');
  assert.equal(body.surface, surface);
}

for (const file of CUT_01A_ROUTE_FILES) {
  test(`static: ${file} imports out-of-core surface guard`, () => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(
      src.includes('@/lib/api/out-of-core-surface'),
      `${file} must import out-of-core surface guard`,
    );
    assert.ok(
      src.includes('assertOutOfCoreSurfaceAllowed'),
      `${file} must call assertOutOfCoreSurfaceAllowed`,
    );
  });
}

test('NODE_ENV=production => POST /api/webhooks/google-spend 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/webhooks/google-spend', { method: 'POST', body: '{}' });
    await expect410(() => postGoogleSpendWebhook(req), 'google_spend_webhook');
  }));

test('VERCEL_ENV=production => GET /api/dashboard/spend 410', async () =>
  withProdEnv({ VERCEL_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/dashboard/spend?siteId=00000000-0000-0000-0000-000000000001');
    await expect410(() => getDashboardSpend(req), 'google_spend_dashboard');
  }));

test('OCI_ENV=production => GET /api/stats/realtime 410', async () =>
  withProdEnv({ OCI_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/stats/realtime?siteId=00000000-0000-0000-0000-000000000001');
    await expect410(() => getStatsRealtime(req), 'stats_realtime');
  }));

test('NODE_ENV=production => GET /api/reporting/dashboard-stats 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest(
      'http://localhost/api/reporting/dashboard-stats?siteId=00000000-0000-0000-0000-000000000001',
    );
    await expect410(() => getReportingDashboardStats(req), 'reporting_dashboard_stats');
  }));

test('static: dashboard spend PROD_OFF guard runs before createClient', () => {
  clearProdMarkers();
  const src = readFileSync(join(ROOT, 'app/api/dashboard/spend/route.ts'), 'utf8');
  const guardIdx = src.indexOf('assertOutOfCoreSurfaceAllowed');
  const clientIdx = src.indexOf('createClient');
  assert.ok(guardIdx >= 0 && clientIdx >= 0 && guardIdx < clientIdx, 'guard must precede auth/db');
});
