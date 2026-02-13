/**
 * Unit tests for API-edge idempotency: key determinism and duplicate detection.
 * - v1: computeIdempotencyKey unchanged (same inputs => same 64-hex key); stable expected value.
 * - v2: computeIdempotencyKeyV2 event-specific buckets (heartbeat 10s, page_view 2s, click/call_intent 0s); prefix "v2:".
 * - tryInsertIdempotencyKey returns inserted: false on unique violation (23505).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIdempotencyKey,
  computeIdempotencyKeyV2,
  computeIdempotencyExpiresAt,
  getServerNowMs,
  tryInsertIdempotencyKey,
  getIdempotencyVersion,
  idempotencyVersionFromKey,
} from '@/lib/idempotency';
import type { ValidIngestPayload } from '@/lib/types/ingest';

const SITE_UUID = 'a0000000-0000-0000-0000-000000000001';

function payload(overrides: Partial<ValidIngestPayload> = {}): ValidIngestPayload {
  return {
    s: 'test_site',
    url: 'https://example.com/page',
    ec: 'cat',
    ea: 'click',
    el: 'button',
    sid: 'sess-123',
    meta: { fp: 'fingerprint-1' },
    ...overrides,
  };
}

test('computeIdempotencyKey: same payload + site => same key (deterministic)', async () => {
  const p = payload();
  const key1 = await computeIdempotencyKey(SITE_UUID, p);
  const key2 = await computeIdempotencyKey(SITE_UUID, p);
  assert.equal(key1, key2, 'same inputs must produce same key');
  assert.equal(key1.length, 64, 'SHA-256 hex length');
  assert.match(key1, /^[0-9a-f]+$/, 'key must be hex (v1)');
});

test('computeIdempotencyKey v1: unchanged by env (always 64 hex, no prefix)', async () => {
  process.env.OPSMANTIK_IDEMPOTENCY_VERSION = '2';
  const key = await computeIdempotencyKey(SITE_UUID, payload());
  delete process.env.OPSMANTIK_IDEMPOTENCY_VERSION;
  assert.match(key, /^[0-9a-f]{64}$/, 'v1 key must be raw hex regardless of env');
});

test('computeIdempotencyKey v1: stable expected value for fixed timestamp', async () => {
  const fixedTs = 1700000000000;
  const bucket = Math.floor(fixedTs / 5000) * 5000;
  const p = payload();
  const input = `${SITE_UUID}:cat|click|button:https://example.com/page:fingerprint-1:${bucket}`;
  const expectedHash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const expectedHex = Array.from(new Uint8Array(expectedHash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const origNow = Date.now;
  Date.now = () => fixedTs;
  try {
    const key = await computeIdempotencyKey(SITE_UUID, p);
    assert.equal(key, expectedHex, 'v1 key must match SHA256(site_id:event_name:url:fp:bucket_5s)');
  } finally {
    Date.now = origNow;
  }
});

test('getIdempotencyVersion: default 1, env 2 => 2', () => {
  const orig = process.env.OPSMANTIK_IDEMPOTENCY_VERSION;
  delete process.env.OPSMANTIK_IDEMPOTENCY_VERSION;
  assert.equal(getIdempotencyVersion(), 1);
  process.env.OPSMANTIK_IDEMPOTENCY_VERSION = '2';
  assert.equal(getIdempotencyVersion(), 2);
  if (orig !== undefined) process.env.OPSMANTIK_IDEMPOTENCY_VERSION = orig;
  else delete process.env.OPSMANTIK_IDEMPOTENCY_VERSION;
});

test('idempotencyVersionFromKey: v2 prefix => 2, else 1', () => {
  assert.equal(idempotencyVersionFromKey('v2:abc123'), 2);
  assert.equal(idempotencyVersionFromKey('abc123'), 1);
  assert.equal(idempotencyVersionFromKey('a'.repeat(64)), 1);
});

test('computeIdempotencyKey: different event => different key', async () => {
  const key1 = await computeIdempotencyKey(SITE_UUID, payload({ ea: 'click' }));
  const key2 = await computeIdempotencyKey(SITE_UUID, payload({ ea: 'submit' }));
  assert.notEqual(key1, key2);
});

test('computeIdempotencyKey: different url => different key', async () => {
  const key1 = await computeIdempotencyKey(SITE_UUID, payload({ url: 'https://a.com' }));
  const key2 = await computeIdempotencyKey(SITE_UUID, payload({ url: 'https://b.com' }));
  assert.notEqual(key1, key2);
});

test('computeIdempotencyKey: different session_fingerprint (meta.fp) => different key', async () => {
  const key1 = await computeIdempotencyKey(SITE_UUID, payload({ meta: { fp: 'fp1' } }));
  const key2 = await computeIdempotencyKey(SITE_UUID, payload({ meta: { fp: 'fp2' } }));
  assert.notEqual(key1, key2);
});

test('tryInsertIdempotencyKey: returns shape { inserted, duplicate, error? }; duplicate yields inserted false, duplicate true', { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY }, async () => {
  const key = await computeIdempotencyKey(SITE_UUID, payload());
  const first = await tryInsertIdempotencyKey(SITE_UUID, key);
  assert.ok(typeof first.inserted === 'boolean');
  assert.ok(typeof first.duplicate === 'boolean');
  if (first.inserted) {
    const second = await tryInsertIdempotencyKey(SITE_UUID, key);
    assert.equal(second.inserted, false, 'second insert with same key must be duplicate');
    assert.equal(second.duplicate, true, 'duplicate must set duplicate: true');
    assert.equal(second.error, undefined, 'duplicate must not set error');
  }
});

test('computeIdempotencyExpiresAt: >= now + 90 days (Revenue Kernel retention)', () => {
  const now = new Date();
  const expiresAt = computeIdempotencyExpiresAt(now);
  const minExpected = new Date(now);
  minExpected.setUTCDate(minExpected.getUTCDate() + 89);
  assert.ok(expiresAt >= minExpected, 'expires_at must be at least 90 days from now');
});

test('PR gate: concurrent same key => exactly one inserted', { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY }, async () => {
  const key = await computeIdempotencyKey(SITE_UUID, payload({ url: 'https://concurrent-test.example/' }));
  const [r1, r2] = await Promise.all([
    tryInsertIdempotencyKey(SITE_UUID, key),
    tryInsertIdempotencyKey(SITE_UUID, key),
  ]);
  const insertedCount = [r1.inserted, r2.inserted].filter(Boolean).length;
  assert.equal(insertedCount, 1, 'exactly one concurrent insert must succeed');
});

// --- PR-2 v2 tests (computeIdempotencyKeyV2, event-specific buckets) ---

test('computeIdempotencyKeyV2: key has prefix v2: and 64 hex', async () => {
  const key = await computeIdempotencyKeyV2(SITE_UUID, payload({ ea: 'heartbeat' }));
  assert.match(key, /^v2:[0-9a-f]{64}$/, 'v2 key must be v2:<64 hex>');
});

test('computeIdempotencyKeyV2: heartbeat 10s bucket — same ts => same key', async () => {
  const p = payload({ ec: 'system', ea: 'heartbeat', el: 'session_active' });
  const ts = 1700000000000;
  const key1 = await computeIdempotencyKeyV2(SITE_UUID, p, ts);
  const key2 = await computeIdempotencyKeyV2(SITE_UUID, p, ts + 5000);
  assert.equal(key1, key2, 'same 10s bucket => same key');
});

test('computeIdempotencyKeyV2: heartbeat 10s bucket — across boundary => different key', async () => {
  const p = payload({ ec: 'system', ea: 'heartbeat', el: 'session_active' });
  const key1 = await computeIdempotencyKeyV2(SITE_UUID, p, 1700000000000);
  const key2 = await computeIdempotencyKeyV2(SITE_UUID, p, 1700000000000 + 15000);
  assert.notEqual(key1, key2, 'across 10s boundary => different key');
});

test('computeIdempotencyKeyV2: page_view 2s bucket — same ts => same key', async () => {
  const p = payload({ ec: 'page', ea: 'view', url: 'https://example.com/p' });
  const ts = 1700000000000;
  const key1 = await computeIdempotencyKeyV2(SITE_UUID, p, ts);
  const key2 = await computeIdempotencyKeyV2(SITE_UUID, p, ts + 1000);
  assert.equal(key1, key2, 'same 2s bucket => same key');
});

test('computeIdempotencyKeyV2: page_view 2s bucket — across boundary => different key', async () => {
  const p = payload({ ec: 'page', ea: 'view', url: 'https://example.com/p' });
  const key1 = await computeIdempotencyKeyV2(SITE_UUID, p, 1700000000000);
  const key2 = await computeIdempotencyKeyV2(SITE_UUID, p, 1700000000000 + 3000);
  assert.notEqual(key1, key2, 'across 2s boundary => different key');
});

test('computeIdempotencyKeyV2: click/call_intent no bucket — different server ts => different key', async () => {
  const pClick = payload({ ea: 'click', ec: 'cta' });
  const key1 = await computeIdempotencyKeyV2(SITE_UUID, pClick, 1700000000000);
  const key2 = await computeIdempotencyKeyV2(SITE_UUID, pClick, 1700000000001);
  assert.notEqual(key1, key2, 'click: no bucketing, different server ts => different key');
  const pIntent = payload({ ea: 'call_intent', ec: 'conversion' });
  const k3 = await computeIdempotencyKeyV2(SITE_UUID, pIntent, 1700000000000);
  const k4 = await computeIdempotencyKeyV2(SITE_UUID, pIntent, 1700000000002);
  assert.notEqual(k3, k4, 'call_intent: no bucketing, different server ts => different key');
});

test('computeIdempotencyKeyV2: click ignores client timestamp (server-only time)', async () => {
  const serverNow = 1700000000000;
  const pSame = { ...payload({ ea: 'click', ec: 'cta' }), ts: 1 };
  const key1 = await computeIdempotencyKeyV2(SITE_UUID, pSame as ValidIngestPayload, serverNow);
  const pWithDifferentClientTs = { ...payload({ ea: 'click', ec: 'cta' }), ts: 999999999 };
  const key2 = await computeIdempotencyKeyV2(SITE_UUID, pWithDifferentClientTs as ValidIngestPayload, serverNow);
  assert.equal(key1, key2, 'click must use server time only; client ts must be ignored');
});

test('computeIdempotencyKeyV2: call_intent ignores client timestamp (server-only time)', async () => {
  const serverNow = 1700000000000;
  const p1 = { ...payload({ ea: 'call_intent', ec: 'conversion' }), timestamp: 100 };
  const p2 = { ...payload({ ea: 'call_intent', ec: 'conversion' }), meta: { ...payload().meta, ts: 200 } };
  const key1 = await computeIdempotencyKeyV2(SITE_UUID, p1 as ValidIngestPayload, serverNow);
  const key2 = await computeIdempotencyKeyV2(SITE_UUID, p2 as ValidIngestPayload, serverNow);
  assert.equal(key1, key2, 'call_intent must use server time only; client timestamp/meta.ts ignored');
});

test('computeIdempotencyKeyV2: different event types => different keys', async () => {
  const ts = 1700000000000;
  const heartbeat = await computeIdempotencyKeyV2(SITE_UUID, payload({ ea: 'heartbeat' }), ts);
  const pageView = await computeIdempotencyKeyV2(SITE_UUID, payload({ ec: 'page', ea: 'view' }), ts);
  const click = await computeIdempotencyKeyV2(SITE_UUID, payload({ ea: 'click' }), ts);
  assert.notEqual(heartbeat, pageView);
  assert.notEqual(pageView, click);
  assert.notEqual(heartbeat, click);
});

test('computeIdempotencyKeyV2: heartbeat with payload ts >5min from server uses server time (clamped)', async () => {
  const serverNow = 1700000000000;
  const pWithFarFuture = { ...payload({ ea: 'heartbeat', ec: 'system' }), ts: (serverNow + 10 * 60 * 1000) / 1000 };
  const pWithFarPast = { ...payload({ ea: 'heartbeat', ec: 'system' }), ts: (serverNow - 10 * 60 * 1000) / 1000 };
  const keyFuture = await computeIdempotencyKeyV2(SITE_UUID, pWithFarFuture as ValidIngestPayload, serverNow);
  const keyPast = await computeIdempotencyKeyV2(SITE_UUID, pWithFarPast as ValidIngestPayload, serverNow);
  const keyNoTs = await computeIdempotencyKeyV2(SITE_UUID, payload({ ea: 'heartbeat', ec: 'system' }), serverNow);
  assert.equal(keyFuture, keyNoTs, 'far-future payload ts clamped to server => same bucket as no ts');
  assert.equal(keyPast, keyNoTs, 'far-past payload ts clamped to server => same bucket as no ts');
});

test('computeIdempotencyKeyV2: page_view with payload ts within 5min uses payload ts bucket', async () => {
  const serverNow = 1700000000000;
  const withinFiveMin = serverNow + 60 * 1000;
  const pWithTs = { ...payload({ ec: 'page', ea: 'view', url: 'https://example.com/x' }), ts: withinFiveMin / 1000 };
  const keyWithTs = await computeIdempotencyKeyV2(SITE_UUID, pWithTs as ValidIngestPayload, serverNow);
  const keyWithServer = await computeIdempotencyKeyV2(SITE_UUID, payload({ ec: 'page', ea: 'view', url: 'https://example.com/x' }), withinFiveMin);
  assert.equal(keyWithTs, keyWithServer, 'payload ts within 5min used; same 2s bucket as server at that time');
});

test('getServerNowMs returns number', () => {
  const t = getServerNowMs();
  assert.equal(typeof t, 'number');
  assert.ok(t >= 1700000000000, 'reasonable ms');
});

test('PR gate v2: concurrent same key (heartbeat) => exactly one inserted', { skip: !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY }, async () => {
  const ts = Date.now();
  const key = await computeIdempotencyKeyV2(SITE_UUID, payload({ ea: 'heartbeat', url: 'https://concurrent-v2.example/' }), ts);
  const [r1, r2] = await Promise.all([
    tryInsertIdempotencyKey(SITE_UUID, key),
    tryInsertIdempotencyKey(SITE_UUID, key),
  ]);
  const insertedCount = [r1.inserted, r2.inserted].filter(Boolean).length;
  assert.equal(insertedCount, 1, 'v2: exactly one concurrent insert must succeed for same key');
});
