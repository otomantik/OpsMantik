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
import { GET as getConversations, POST as postConversations } from '@/app/api/conversations/route';
import { GET as getConversationDetail } from '@/app/api/conversations/[id]/route';
import { POST as postConversationsAssign } from '@/app/api/conversations/assign/route';
import { POST as postConversationsFollowUp } from '@/app/api/conversations/follow-up/route';
import { POST as postConversationsLink } from '@/app/api/conversations/link/route';
import { POST as postConversationsNote } from '@/app/api/conversations/note/route';
import { POST as postConversationsReopen } from '@/app/api/conversations/reopen/route';
import { POST as postConversationsResolve } from '@/app/api/conversations/resolve/route';
import { POST as postConversationsStage } from '@/app/api/conversations/stage/route';

const ROOT = process.cwd();

const SITE_ID = '00000000-0000-0000-0000-000000000001';
const CONVERSATION_ID = '00000000-0000-0000-0000-000000000002';

const CUT_01A_ROUTE_FILES = [
  'app/api/webhooks/google-spend/route.ts',
  'app/api/dashboard/spend/route.ts',
  'app/api/stats/realtime/route.ts',
  'app/api/reporting/dashboard-stats/route.ts',
] as const;

const CUT_01C_ROUTE_FILES = [
  'app/api/conversations/route.ts',
  'app/api/conversations/[id]/route.ts',
  'app/api/conversations/assign/route.ts',
  'app/api/conversations/follow-up/route.ts',
  'app/api/conversations/link/route.ts',
  'app/api/conversations/note/route.ts',
  'app/api/conversations/reopen/route.ts',
  'app/api/conversations/resolve/route.ts',
  'app/api/conversations/stage/route.ts',
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

for (const file of [...CUT_01A_ROUTE_FILES, ...CUT_01C_ROUTE_FILES]) {
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

for (const file of CUT_01C_ROUTE_FILES) {
  test(`static: ${file} PROD_OFF guard runs before createClient`, () => {
    clearProdMarkers();
    const src = readFileSync(join(ROOT, file), 'utf8');
    const guardIdx = src.indexOf('assertOutOfCoreSurfaceAllowed');
    const clientIdx = src.indexOf('createClient');
    assert.ok(guardIdx >= 0 && clientIdx >= 0 && guardIdx < clientIdx, 'guard must precede auth/db');
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

test('NODE_ENV=production => GET /api/conversations 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest(`http://localhost/api/conversations?site_id=${SITE_ID}`);
    await expect410(() => getConversations(req), 'conversations_collection');
  }));

test('NODE_ENV=production => POST /api/conversations 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/conversations', { method: 'POST', body: '{}' });
    await expect410(() => postConversations(req), 'conversations_collection');
  }));

test('NODE_ENV=production => GET /api/conversations/[id] 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest(`http://localhost/api/conversations/${CONVERSATION_ID}`);
    await expect410(
      () => getConversationDetail(req, { params: Promise.resolve({ id: CONVERSATION_ID }) }),
      'conversations_detail',
    );
  }));

test('NODE_ENV=production => POST /api/conversations/assign 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/conversations/assign', { method: 'POST', body: '{}' });
    await expect410(() => postConversationsAssign(req), 'conversations_assign');
  }));

test('NODE_ENV=production => POST /api/conversations/follow-up 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/conversations/follow-up', { method: 'POST', body: '{}' });
    await expect410(() => postConversationsFollowUp(req), 'conversations_follow_up');
  }));

test('NODE_ENV=production => POST /api/conversations/link 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/conversations/link', { method: 'POST', body: '{}' });
    await expect410(() => postConversationsLink(req), 'conversations_link');
  }));

test('NODE_ENV=production => POST /api/conversations/note 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/conversations/note', { method: 'POST', body: '{}' });
    await expect410(() => postConversationsNote(req), 'conversations_note');
  }));

test('NODE_ENV=production => POST /api/conversations/reopen 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/conversations/reopen', { method: 'POST', body: '{}' });
    await expect410(() => postConversationsReopen(req), 'conversations_reopen');
  }));

test('NODE_ENV=production => POST /api/conversations/resolve 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/conversations/resolve', { method: 'POST', body: '{}' });
    await expect410(() => postConversationsResolve(req), 'conversations_resolve');
  }));

test('NODE_ENV=production => POST /api/conversations/stage 410', async () =>
  withProdEnv({ NODE_ENV: 'production' }, async () => {
    const req = new NextRequest('http://localhost/api/conversations/stage', { method: 'POST', body: '{}' });
    await expect410(() => postConversationsStage(req), 'conversations_stage');
  }));
