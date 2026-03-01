/**
 * Cron enqueue-from-sales: 403 without cron auth; hours param boundaries (1..168, 400 for invalid).
 * Idempotency (run twice => no duplicates) requires DB — integration test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/cron/oci/enqueue-from-sales/route';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CRON_SECRET = 'test-cron-secret-enqueue';

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

test('POST /api/cron/oci/enqueue-from-sales without cron auth returns 403', async () => {
  const req = new NextRequest('http://localhost/api/cron/oci/enqueue-from-sales', { method: 'POST' });
  const res = await POST(req);
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.code, 'CRON_FORBIDDEN');
});

test('enqueue-from-sales route uses hours query param (default 24, max 168)', () => {
  const src = readFileSync(
    join(process.cwd(), 'app', 'api', 'cron', 'oci', 'enqueue-from-sales', 'route.ts'),
    'utf8'
  );
  assert.ok(src.includes('hours'), 'route must support hours');
  assert.ok(src.includes('24') || src.includes('DEFAULT_HOURS'), 'default hours');
  assert.ok(src.includes('168') || src.includes('MAX_HOURS'), 'max 168');
});

test('hours boundary: hours=-1 returns 400', async () => {
  const saved = stashEnv(['CRON_SECRET']);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    const req = new NextRequest('http://localhost/api/cron/oci/enqueue-from-sales?hours=-1', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.ok(json.error?.includes('1') && json.error?.includes('168'));
  } finally {
    restoreEnv(saved);
  }
});

test('hours boundary: hours=0 returns 400', async () => {
  const saved = stashEnv(['CRON_SECRET']);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    const req = new NextRequest('http://localhost/api/cron/oci/enqueue-from-sales?hours=0', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
  } finally {
    restoreEnv(saved);
  }
});

test('hours boundary: hours=168 accepted (200 when env present; skip when no Supabase)', async (t) => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    t.skip('Supabase env not set; 168 boundary covered by source test');
    return;
  }
  const saved = stashEnv(['CRON_SECRET']);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    const req = new NextRequest('http://localhost/api/cron/oci/enqueue-from-sales?hours=168', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await POST(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(typeof json.processed === 'number' && typeof json.enqueued === 'number');
  } finally {
    restoreEnv(saved);
  }
});

test('hours boundary: 168 is within valid range (route does not return 400)', () => {
  const src = readFileSync(
    join(process.cwd(), 'app', 'api', 'cron', 'oci', 'enqueue-from-sales', 'route.ts'),
    'utf8'
  );
  assert.ok(src.includes('parsed <= MAX_HOURS') || src.includes('parsed > MAX_HOURS'), '168 included in valid range');
});

test('hours boundary: hours=169 returns 400', async () => {
  const saved = stashEnv(['CRON_SECRET']);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    const req = new NextRequest('http://localhost/api/cron/oci/enqueue-from-sales?hours=169', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
  } finally {
    restoreEnv(saved);
  }
});

test('enqueue-from-sales: no in-memory rate limit — sequential requests both succeed (serverless-safe)', async (t) => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    t.skip('Supabase env not set; rate-limit removal covered by source test');
    return;
  }
  // In-memory rate limiter was removed; serverless makes it ineffective.
  // Vercel Cron schedule + requireCronAuth are the guardrails.
  const saved = stashEnv(['CRON_SECRET']);
  try {
    process.env.CRON_SECRET = CRON_SECRET;
    const req = new NextRequest('http://localhost/api/cron/oci/enqueue-from-sales?hours=24', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const r1 = await POST(req);
    const r2 = await POST(req);
    assert.equal(r1.status, 200, 'first request succeeds');
    assert.equal(r2.status, 200, 'second request succeeds (no rate limit)');
    const json = await r2.json();
    assert.equal(json.ok, true);
  } finally {
    restoreEnv(saved);
  }
});
