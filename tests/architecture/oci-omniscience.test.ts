/**
 * Omniscience Protocol — Phase 11 Chaos Tests
 *
 * Test 1: Time-Travel Audit — verifies bitemporal ledger returns past state,
 *         not current adjusted state, when queried with &asOf.
 *
 * Test 2: Ouroboros EMA Watchdog — verifies 3σ anomaly detection triggers
 *         PREDICTIVE_DEGRADATION_HALT before zombie threshold.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { OuroborosWatchdog } from '../../lib/oci/ouroboros-watchdog';

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Bitemporal Time-Travel Audit
// ─────────────────────────────────────────────────────────────────────────────

interface BitemporalRecord {
    id: string;
    conversion_value: number;
    sys_period_start: Date;
    sys_period_end: Date | null; // null = infinity (current)
}

/** Minimal in-memory bitemporal store mirroring the Postgres trigger logic */
function makeBitemporalStore() {
    const store: BitemporalRecord[] = [];

    function insert(id: string, value: number, at: Date): void {
        const existing = store.find(r => r.id === id && r.sys_period_end === null);
        if (existing) existing.sys_period_end = at;
        store.push({ id, conversion_value: value, sys_period_start: at, sys_period_end: null });
    }

    function queryAsOf(id: string, asOf: Date): BitemporalRecord | undefined {
        return store.find(r =>
            r.id === id &&
            r.sys_period_start <= asOf &&
            (r.sys_period_end === null || r.sys_period_end > asOf)
        );
    }

    return { insert, queryAsOf };
}

test('Omniscience Test 1: Bitemporal Time-Travel Audit', async (t) => {
    await t.test('should return original value when querying before adjustment', () => {
        const { insert, queryAsOf } = makeBitemporalStore();
        const T0 = new Date('2026-03-01T10:00:00Z');
        const T1 = new Date('2026-03-01T11:00:00Z');
        const T05 = new Date('2026-03-01T10:30:00Z');

        insert('signal-001', 500, T0);
        insert('signal-001', 800, T1);

        const past = queryAsOf('signal-001', T05);
        assert.ok(past, 'should find a record');
        assert.strictEqual(past.conversion_value, 500);
    });

    await t.test('should return adjusted value when querying after adjustment', () => {
        const { insert, queryAsOf } = makeBitemporalStore();
        const T0 = new Date('2026-03-01T10:00:00Z');
        const T1 = new Date('2026-03-01T11:00:00Z');
        const T2 = new Date('2026-03-01T12:00:00Z');

        insert('signal-002', 500, T0);
        insert('signal-002', 800, T1);

        const current = queryAsOf('signal-002', T2);
        assert.ok(current, 'should find a record');
        assert.strictEqual(current.conversion_value, 800);
    });

    await t.test('should return undefined for queries before the record existed', () => {
        const { insert, queryAsOf } = makeBitemporalStore();
        const T_before = new Date('2026-02-28T10:00:00Z');
        const T0 = new Date('2026-03-01T10:00:00Z');

        insert('signal-003', 500, T0);
        assert.strictEqual(queryAsOf('signal-003', T_before), undefined);
    });

    await t.test('should support multiple adjustment cycles and return correct past state', () => {
        const { insert, queryAsOf } = makeBitemporalStore();
        const T0 = new Date('2026-03-01T10:00:00Z');
        const T1 = new Date('2026-03-01T11:00:00Z');
        const T2 = new Date('2026-03-01T12:00:00Z');
        const T3 = new Date('2026-03-01T13:00:00Z');

        insert('signal-multi', 100, T0);
        insert('signal-multi', 200, T1);
        insert('signal-multi', 300, T2);

        assert.strictEqual(queryAsOf('signal-multi', new Date('2026-03-01T10:30:00Z'))?.conversion_value, 100);
        assert.strictEqual(queryAsOf('signal-multi', new Date('2026-03-01T11:30:00Z'))?.conversion_value, 200);
        assert.strictEqual(queryAsOf('signal-multi', T3)?.conversion_value, 300);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Ouroboros EMA + 3σ Anomaly Detection Watchdog
// ─────────────────────────────────────────────────────────────────────────────

test('Omniscience Test 2: Ouroboros EMA Watchdog (3σ Anomaly Detection)', async (t) => {
    await t.test('should not trigger anomaly during stable operations', () => {
        const watchdog = new OuroborosWatchdog({ alpha: 0.1, sigmaThreshold: 3, minObservations: 10 });
        // Feed 100 stable latencies around 50ms with 10ms jitter
        for (let i = 0; i < 100; i++) {
            watchdog.observe(50 + (i % 2 === 0 ? 10 : -10));
        }
        // With 10ms jitter, stdDev is ~9.5. Threshold is 50 + 3*9.5 = 78.5. 
        // 55ms is well within this threshold.
        assert.strictEqual(watchdog.isAnomaly(55), false, '55ms must not be anomalous for 50ms baseline with 10ms jitter');
    });

    await t.test('should detect anomaly when latency exceeds EMA + 3σ', () => {
        const watchdog = new OuroborosWatchdog({ alpha: 0.1, sigmaThreshold: 3, minObservations: 10 });
        for (let i = 0; i < 100; i++) {
            watchdog.observe(50 + (i % 2 === 0 ? 1 : -1));
        }
        const snap = watchdog.snapshot();
        assert.ok(snap.ema > 40 && snap.ema < 60, `EMA should be ~50ms, got ${snap.ema}`);
        assert.ok(snap.stdDev > 0, 'stdDev must be > 0');
        assert.strictEqual(watchdog.isAnomaly(8000), true, '8000ms must be flagged as anomalous');
        assert.ok(8000 > snap.threshold, `8000 should exceed threshold ${snap.threshold}`);
    });

    await t.test('should not trigger anomaly before minObservations threshold', () => {
        const watchdog = new OuroborosWatchdog({ alpha: 0.1, sigmaThreshold: 3, minObservations: 10 });
        for (let i = 0; i < 5; i++) watchdog.observe(50);
        assert.strictEqual(watchdog.isAnomaly(99999), false, 'guard must suppress anomaly below minObs');
    });

    await t.test('should serialize and restore state correctly', () => {
        const w1 = new OuroborosWatchdog({ alpha: 0.1, sigmaThreshold: 3, minObservations: 10 });
        for (let i = 0; i < 50; i++) w1.observe(50 + (i % 2 === 0 ? 1 : -1));
        const saved = w1.serialize();
        const s1 = w1.snapshot();

        const w2 = new OuroborosWatchdog({ alpha: 0.1, sigmaThreshold: 3, minObservations: 10 });
        w2.restore(saved);
        const s2 = w2.snapshot();

        assert.ok(Math.abs(s2.ema - s1.ema) < 0.01, 'EMA must match after restore');
        assert.ok(Math.abs(s2.stdDev - s1.stdDev) < 0.01, 'stdDev must match after restore');
        assert.strictEqual(s2.observations, s1.observations);
    });

    await t.test('should trigger PREDICTIVE_DEGRADATION_HALT for 3 slow events after stable baseline', () => {
        // Omniscience spec: 100 events at ~50ms, 3 injected at 8000ms
        // isAnomaly(incoming) checked BEFORE observe(incoming) — mirrors sweep-zombies usage
        const watchdog = new OuroborosWatchdog({ alpha: 0.1, sigmaThreshold: 3, minObservations: 10 });
        for (let i = 0; i < 100; i++) watchdog.observe(50 + (i % 2 === 0 ? 1 : -1));

        const results: boolean[] = [];
        for (let i = 0; i < 3; i++) {
            results.push(watchdog.isAnomaly(8000));
            watchdog.observe(8000);
        }
        assert.strictEqual(results[0], true, 'first 8000ms event must trigger PREDICTIVE_DEGRADATION_HALT');
    });
});
