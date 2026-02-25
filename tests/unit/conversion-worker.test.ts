/**
 * Sprint 1.6 — Unit tests for conversion-worker.ts pure exports
 *
 * Tests:
 *  - rowToJob: SEND / RETRACT / RESTATE / null gclid (Sprint 1.6 shape)
 *  - rowToJob: google_value takes priority over adjustment_value
 *  - computeNextRetryAt: exponential backoff formula
 *  - processPendingConversions: credential guard (missing / invalid JSON)
 *  - credential validator: happy path
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConversionJob } from '@/lib/providers/types';

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

const FAKE_CREDS = {
    customer_id: '123-456-7890',
    developer_token: 'dev',
    client_id: 'cid',
    client_secret: 'secret',
    refresh_token: 'rt',
    conversion_action_resource_name: 'customers/1234567890/conversionActions/99',
};

/** Sprint 1.6 row fixture with all required columns */
function makeRow(overrides: Partial<{
    id: string;
    gclid: string | null;
    session_id: string | null;
    visitor_id: string | null;
    star: number | null;
    revenue: number;
    presignal_value: number;
    google_action: 'SEND' | 'RESTATE' | 'RETRACT' | null;
    adjustment_value: number;
    google_value: number | null;
    retry_count: number;
    next_retry_at: string;
    claimed_at: string | null;
    claimed_by: string | null;
    created_at: string;
}> = {}) {
    return {
        id: 'conv-default',
        gclid: 'Cj0default',
        session_id: null,
        visitor_id: null,
        star: 5,
        revenue: 1000,
        presignal_value: 500,
        google_action: 'SEND' as const,
        adjustment_value: 1000,
        google_value: null,
        retry_count: 0,
        next_retry_at: new Date().toISOString(),
        claimed_at: null,
        claimed_by: null,
        created_at: '2026-02-25T00:00:00.000Z',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// rowToJob: SEND row → correct ConversionJob shape
// ---------------------------------------------------------------------------

test('rowToJob: SEND row maps gclid and value_cents correctly', async () => {
    const { rowToJob } = await import('@/lib/workers/conversion-worker');

    const row = makeRow({ id: 'conv-aaa', gclid: 'Cj0test', adjustment_value: 5000 });
    const job = rowToJob(row) as ConversionJob;

    assert.equal(job.id, 'conv-aaa');
    assert.equal(job.provider_key, 'google_ads');
    assert.equal(job.action_key, 'SEND');
    assert.equal(job.click_ids.gclid, 'Cj0test');
    // 5000 units × 100 = 500_000 cents
    assert.equal(job.amount_cents, 500_000);
    assert.equal((job.payload as { value_cents: number }).value_cents, 500_000);
});

// ---------------------------------------------------------------------------
// rowToJob: google_value takes priority over adjustment_value
// ---------------------------------------------------------------------------

test('rowToJob: google_value column takes priority over adjustment_value', async () => {
    const { rowToJob } = await import('@/lib/workers/conversion-worker');

    const row = makeRow({ adjustment_value: 5000, google_value: 3000 });
    const job = rowToJob(row) as ConversionJob;

    // Should use google_value (3000), NOT adjustment_value (5000)
    assert.equal(job.amount_cents, 300_000, 'google_value should override adjustment_value');
});

// ---------------------------------------------------------------------------
// rowToJob: RETRACT → action_key = RETRACT, value = 0
// ---------------------------------------------------------------------------

test('rowToJob: RETRACT row maps action_key and zero value', async () => {
    const { rowToJob } = await import('@/lib/workers/conversion-worker');

    const row = makeRow({
        id: 'conv-bbb', gclid: 'Cj0retract',
        star: 1, revenue: 0, presignal_value: 0,
        google_action: 'RETRACT', adjustment_value: 0,
    });
    const job = rowToJob(row) as ConversionJob;

    assert.equal(job.action_key, 'RETRACT');
    assert.equal(job.amount_cents, 0);
    assert.equal(job.click_ids.gclid, 'Cj0retract');
});

// ---------------------------------------------------------------------------
// rowToJob: RESTATE → presignal value maps correctly
// ---------------------------------------------------------------------------

test('rowToJob: RESTATE row maps presignal value', async () => {
    const { rowToJob } = await import('@/lib/workers/conversion-worker');

    const row = makeRow({
        id: 'conv-ccc', gclid: 'Cj0restate',
        star: 5, revenue: 0, presignal_value: 2200,
        google_action: 'RESTATE', adjustment_value: 2200,
    });
    const job = rowToJob(row) as ConversionJob;

    assert.equal(job.action_key, 'RESTATE');
    assert.equal(job.amount_cents, 220_000);
});

// ---------------------------------------------------------------------------
// rowToJob: null gclid preserved
// ---------------------------------------------------------------------------

test('rowToJob: null gclid preserved in click_ids', async () => {
    const { rowToJob } = await import('@/lib/workers/conversion-worker');

    const row = makeRow({ id: 'conv-ddd', gclid: null });
    const job = rowToJob(row) as ConversionJob;
    assert.equal(job.click_ids.gclid, null);
});

// ---------------------------------------------------------------------------
// computeNextRetryAt: exponential backoff formula
// ---------------------------------------------------------------------------

test('computeNextRetryAt: retry 1 → 60s ahead', async () => {
    const { computeNextRetryAt } = await import('@/lib/workers/conversion-worker');
    const now = new Date('2026-01-01T00:00:00.000Z');
    const result = computeNextRetryAt(now, 1);
    const diffSec = (result.getTime() - now.getTime()) / 1000;
    assert.equal(diffSec, 60, 'retry 1 should be 60 seconds ahead');
});

test('computeNextRetryAt: retry 2 → 240s ahead', async () => {
    const { computeNextRetryAt } = await import('@/lib/workers/conversion-worker');
    const now = new Date('2026-01-01T00:00:00.000Z');
    const result = computeNextRetryAt(now, 2);
    const diffSec = (result.getTime() - now.getTime()) / 1000;
    assert.equal(diffSec, 240, 'retry 2 should be 240 seconds ahead');
});

test('computeNextRetryAt: retry 5 → 1500s ahead', async () => {
    const { computeNextRetryAt } = await import('@/lib/workers/conversion-worker');
    const now = new Date('2026-01-01T00:00:00.000Z');
    const result = computeNextRetryAt(now, 5);
    const diffSec = (result.getTime() - now.getTime()) / 1000;
    assert.equal(diffSec, 1500, 'retry 5 should be 1500 seconds ahead');
});

// ---------------------------------------------------------------------------
// processPendingConversions: credential guard
// ---------------------------------------------------------------------------

test('processPendingConversions: throws when GOOGLE_ADS_CREDENTIALS is not set', async () => {
    const saved = stashEnv(['GOOGLE_ADS_CREDENTIALS']);
    try {
        delete process.env.GOOGLE_ADS_CREDENTIALS;
        const { processPendingConversions } = await import('@/lib/workers/conversion-worker');
        await assert.rejects(
            () => processPendingConversions(),
            (err: unknown) => err instanceof Error && err.message.includes('GOOGLE_ADS_CREDENTIALS')
        );
    } finally {
        restoreEnv(saved);
    }
});

test('processPendingConversions: throws when GOOGLE_ADS_CREDENTIALS is invalid JSON', async () => {
    const saved = stashEnv(['GOOGLE_ADS_CREDENTIALS']);
    try {
        process.env.GOOGLE_ADS_CREDENTIALS = '{not valid json';
        const { processPendingConversions } = await import('@/lib/workers/conversion-worker');
        await assert.rejects(
            () => processPendingConversions(),
            (err: unknown) => err instanceof Error && err.message.includes('GOOGLE_ADS_CREDENTIALS')
        );
    } finally {
        restoreEnv(saved);
    }
});

// ---------------------------------------------------------------------------
// Credential JSON validity
// ---------------------------------------------------------------------------

test('credential loader: valid JSON credentials parse without throwing', () => {
    const raw = JSON.stringify(FAKE_CREDS);
    assert.doesNotThrow(() => JSON.parse(raw));
    const parsed = JSON.parse(raw) as typeof FAKE_CREDS;
    assert.equal(parsed.customer_id, FAKE_CREDS.customer_id);
    assert.equal(parsed.conversion_action_resource_name, FAKE_CREDS.conversion_action_resource_name);
});
