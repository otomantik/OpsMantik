/**
 * Omniscience Protocol Chaos Tests
 *
 * Ouroboros EMA Watchdog — verifies 3σ anomaly detection triggers
 * PREDICTIVE_DEGRADATION_HALT before zombie threshold.
 *
 * NOTE: The Phase 11 bitemporal time-travel tests were removed in Phase 4 when
 * the marketing_signals bitemporal ledger (sys_period/valid_period/history
 * table/get_marketing_signals_as_of RPC) was dropped as YAGNI. See
 * supabase/migrations/20260419170000_drop_bitemporal_marketing_signals.sql.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { OuroborosWatchdog } from '../../lib/oci/ouroboros-watchdog';

// ─────────────────────────────────────────────────────────────────────────────
// Ouroboros EMA + 3σ Anomaly Detection Watchdog
// ─────────────────────────────────────────────────────────────────────────────

test('Ouroboros EMA Watchdog (3σ Anomaly Detection)', async (t) => {
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
