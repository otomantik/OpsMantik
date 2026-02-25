/**
 * Sprint 1.5 — Unit tests for POST /api/cron/dispatch-conversions
 *
 * Focus: cron auth guard (no mocking of worker internals needed for these).
 * Worker logic is covered separately in conversion-worker.test.ts.
 *
 * Coverage:
 *   1. No cron auth → 403 CRON_FORBIDDEN
 *   2. Wrong bearer token in prod → 403
 *   3. x-vercel-cron: 1 header → passes auth guard (worker may fail due to missing env, that's ok)
 *   4. Bearer CRON_SECRET in dev mode (ALLOW_BEARER_CRON=true) → passes auth guard
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function stashEnv(keys: string[]): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = process.env[k];
    return out;
}
function restoreEnv(snap: Record<string, string | undefined>): void {
    for (const k of Object.keys(snap)) {
        if (snap[k] === undefined) delete process.env[k];
        else process.env[k] = snap[k];
    }
}

const CRON_SECRET = 'test-dispatch-secret-abc';

// ---------------------------------------------------------------------------
// 1. No auth → 403
// ---------------------------------------------------------------------------

test('POST /api/cron/dispatch-conversions: no cron auth returns 403', async () => {
    const { POST } = await import('@/app/api/cron/dispatch-conversions/route');
    const req = new NextRequest('http://localhost/api/cron/dispatch-conversions', {
        method: 'POST',
    });
    const res = await POST(req);
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.code, 'CRON_FORBIDDEN');
});

// ---------------------------------------------------------------------------
// 2. Wrong bearer token in prod → 403
// ---------------------------------------------------------------------------

test('POST /api/cron/dispatch-conversions: wrong bearer token returns 403', async () => {
    const saved = stashEnv(['CRON_SECRET', 'NODE_ENV', 'ALLOW_BEARER_CRON']);
    try {
        process.env.CRON_SECRET = CRON_SECRET;
        process.env.NODE_ENV = 'production';
        delete process.env.ALLOW_BEARER_CRON;

        const { POST } = await import('@/app/api/cron/dispatch-conversions/route');
        const req = new NextRequest('http://localhost/api/cron/dispatch-conversions', {
            method: 'POST',
            headers: { authorization: 'Bearer wrong-secret' },
        });
        const res = await POST(req);
        assert.equal(res.status, 403);
    } finally {
        restoreEnv(saved);
    }
});

// ---------------------------------------------------------------------------
// 3. x-vercel-cron passes auth (worker may throw without credentials — that's 500, not 403)
// ---------------------------------------------------------------------------

test('POST /api/cron/dispatch-conversions: x-vercel-cron passes auth guard', async () => {
    const saved = stashEnv(['GOOGLE_ADS_CREDENTIALS']);
    try {
        // Ensure worker throws due to missing creds (500), proving auth was passed
        delete process.env.GOOGLE_ADS_CREDENTIALS;

        const { POST } = await import('@/app/api/cron/dispatch-conversions/route');
        const req = new NextRequest('http://localhost/api/cron/dispatch-conversions', {
            method: 'POST',
            headers: { 'x-vercel-cron': '1' },
        });
        const res = await POST(req);
        // 500 = auth passed, worker failed. 403 = auth failed (test fails).
        assert.ok(res.status !== 403, `Expected auth to pass (not 403), got ${res.status}`);
        const json = await res.json();
        // Should be a 500 with our credential error
        assert.equal(json.ok, false);
        assert.ok(
            json.error?.includes('GOOGLE_ADS_CREDENTIALS'),
            `Expected credential error, got: ${json.error}`
        );
    } finally {
        restoreEnv(saved);
    }
});

// ---------------------------------------------------------------------------
// 4. Bearer CRON_SECRET in dev with ALLOW_BEARER_CRON=true → passes auth
// ---------------------------------------------------------------------------

test('POST /api/cron/dispatch-conversions: Bearer CRON_SECRET in dev passes auth guard', async () => {
    const saved = stashEnv(['CRON_SECRET', 'NODE_ENV', 'ALLOW_BEARER_CRON', 'GOOGLE_ADS_CREDENTIALS']);
    try {
        process.env.CRON_SECRET = CRON_SECRET;
        process.env.NODE_ENV = 'development';
        process.env.ALLOW_BEARER_CRON = 'true';
        delete process.env.GOOGLE_ADS_CREDENTIALS;

        const { POST } = await import('@/app/api/cron/dispatch-conversions/route');
        const req = new NextRequest('http://localhost/api/cron/dispatch-conversions', {
            method: 'POST',
            headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        const res = await POST(req);
        // Auth passed → worker threw due to missing creds → 500 (not 403)
        assert.ok(res.status !== 403, `Expected auth to pass (not 403), got ${res.status}`);
        const json = await res.json();
        assert.equal(json.ok, false);
        assert.ok(json.error?.includes('GOOGLE_ADS_CREDENTIALS'));
    } finally {
        restoreEnv(saved);
    }
});
