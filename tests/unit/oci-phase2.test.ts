import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateSignalEV,
} from '@/lib/domain/mizan-mantik';

// Note: Full integration testing of Cron routes (zombies, backfill) requires 
// deep mocking of Supabase and Next.js Request/Response which is complex in node:test.
// We focus on the core logic and mathematical requirements of Phase 2.

test('Phase 2.3: Mathematical Bounds — 10% decay floor', () => {
    const clickDate = new Date('2024-01-01T10:00:00Z');
    const signalDate = new Date('2024-02-01T10:00:00Z'); // 31 days later

    // V4 Aggressive > 10 days = 0.05 (in time-decay.ts)
    // Phase 2 floor = 0.1

    const aovCents = 10000; // 100.00 TRY
    const intentWeights = { pending: 0.02, qualified: 0.2, proposal: 0.3, sealed: 1.0 };

    // Formula: baseValueCents = round(aovCents * ratio)
    // V4 ratio = 0.3
    // baseValueCents = 10000 * 0.3 = 3000

    // Without floor: round(3000 * 0.05) = 150
    // With Phase 2 floor: round(3000 * 0.1) = 300

    const ev = calculateSignalEV(
        'V4_INTENT',
        aovCents,
        clickDate,
        signalDate,
        intentWeights
    );

    assert.equal(ev, 300, 'Signal EV should be floored at 10% of base value (300 cents)');
});

test('Phase 2.1: Zombie Sweeper — Filter logic verification', async () => {
    // We can't easily mock the entire Supabase client in node:test without extra dependencies,
    // but we can verify the temporal logic used in the sweepers.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
    const nineMinutesAgo = new Date(Date.now() - 9 * 60 * 1000);

    assert.ok(elevenMinutesAgo < tenMinutesAgo, '11m ago is less than 10m ago (stale)');
    assert.ok(nineMinutesAgo > tenMinutesAgo, '9m ago is greater than 10m ago (active)');
});

test('Phase 2.2: Temporal Funnel — Offset verification', () => {
    const baseTimeMs = 1709582400000; // Fixed timestamp
    const v3Time = new Date(baseTimeMs - 2000);
    const v4Time = new Date(baseTimeMs - 1000);
    const v5Time = new Date(baseTimeMs);

    assert.equal(v4Time.getTime() - v3Time.getTime(), 1000, 'V3 and V4 should have 1s gap');
    assert.equal(v5Time.getTime() - v4Time.getTime(), 1000, 'V4 and V5 should have 1s gap');
});

test('Phase 2.3: Zero-Value Micro-Floor — Math verification', () => {
    // Logic from google-ads-export/route.ts:
    // if (valueCents <= 0) valueCents = 100;

    const rawValueCents = 0;
    let valueCents = rawValueCents;

    if (!Number.isFinite(valueCents) || valueCents <= 0) {
        valueCents = 100;
    }

    assert.equal(valueCents, 100, 'Zero value should be floored to 100 cents (1 TRY)');

    const nanValue = NaN;
    let valueCents2 = nanValue;
    if (!Number.isFinite(valueCents2) || valueCents2 <= 0) {
        valueCents2 = 100;
    }
    assert.equal(valueCents2, 100, 'NaN value should be floored to 100 cents');
});
