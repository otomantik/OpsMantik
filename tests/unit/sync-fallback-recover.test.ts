/**
 * Unit tests for sync fallback and recovery.
 * - Recover route: cron auth required; empty batch returns 200 with claimed: 0.
 * - Fallback: when QStash fails, sync inserts buildFallbackRow(...) and returns 200 with x-opsmantik-fallback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { buildFallbackRow } from '@/lib/sync-fallback';

test('recover route: GET with cron auth returns 200 and body shape', { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY }, async () => {
  const { GET } = await import('@/app/api/cron/recover/route');
  const req = new NextRequest('http://localhost:3000/api/cron/recover', {
    method: 'GET',
    headers: { 'x-vercel-cron': '1' },
  });
  const res = await GET(req);
  assert.equal(res.status, 200, 'recover with cron auth must return 200 (empty batch or processed)');
  const body = await res.json();
  assert.ok(typeof body.claimed === 'number');
  assert.ok(typeof body.recovered === 'number');
  assert.ok(typeof body.failed === 'number');
  assert.equal(body.ok, true);
});

test('recover route: GET without cron auth returns 403', async () => {
  const { GET } = await import('@/app/api/cron/recover/route');
  const req = new NextRequest('http://localhost:3000/api/cron/recover', {
    method: 'GET',
    headers: {},
  });
  const res = await GET(req);
  assert.equal(res.status, 403);
});

test('buildFallbackRow: row shape for ingest_fallback_buffer insert', () => {
  const siteId = 'a0000000-0000-0000-0000-000000000001';
  const payload = { s: 'site_public', url: 'https://example.com', ingest_id: 'id-1' };
  const row = buildFallbackRow(siteId, payload, 'QStash timeout');
  assert.equal(row.site_id, siteId);
  assert.deepEqual(row.payload, payload);
  assert.equal(row.error_reason, 'QStash timeout');
  assert.equal(row.status, 'PENDING');
});
