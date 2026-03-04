/**
 * Ouroboros Watchdog — EMA + 3σ Anomaly Detection
 *
 * Provides utility functions to detect processing time anomalies using
 * Exponential Moving Average (EMA) and 3-sigma standard deviation.
 *
 * Usage in sweep-zombies:
 *   const ema = new OuroborosWatchdog({ alpha: 0.1 });
 *   ema.observe(latencyMs);
 *   if (ema.isAnomaly(currentLatencyMs)) { halt(); }
 */

export interface OuroborosConfig {
    /** EMA smoothing factor, 0 < α ≤ 1. Lower = slower-moving average. Default: 0.1 */
    alpha?: number;
    /** Sigma multiplier for anomaly threshold. Default: 3 (3σ = 99.7% confidence). */
    sigmaThreshold?: number;
    /** Minimum number of observations before anomaly detection activates. Default: 10 */
    minObservations?: number;
}

export interface OuroborosSnapshot {
    ema: number;
    emv: number;  // exponential moving variance
    stdDev: number;
    threshold: number;
    observations: number;
}

export class OuroborosWatchdog {
    private alpha: number;
    private sigmaThreshold: number;
    private minObservations: number;

    private _ema = 0;        // Exponential Moving Average of latency
    private _emv = 0;        // Exponential Moving Variance (for std dev)
    private _count = 0;

    constructor(config: OuroborosConfig = {}) {
        this.alpha = config.alpha ?? 0.1;
        this.sigmaThreshold = config.sigmaThreshold ?? 3;
        this.minObservations = config.minObservations ?? 10;
    }

    /**
     * Record a new latency observation (milliseconds).
     * Updates EMA and running variance in O(1) time/space.
     */
    observe(latencyMs: number): void {
        if (this._count === 0) {
            this._ema = latencyMs;
            this._emv = 0;
        } else {
            const delta = latencyMs - this._ema;
            this._ema += this.alpha * delta;
            // Welford's online variance adapted for EMA
            this._emv = (1 - this.alpha) * (this._emv + this.alpha * delta * delta);
        }
        this._count++;
    }

    /**
     * Standard deviation of the observed distribution.
     */
    get stdDev(): number {
        return Math.sqrt(this._emv);
    }

    /**
     * The anomaly detection threshold: EMA + (σ * stdDev)
     */
    get threshold(): number {
        return this._ema + this.sigmaThreshold * this.stdDev;
    }

    /**
     * Returns true if the given latency is an anomaly (> EMA + 3σ).
     * Always returns false until minObservations are collected.
     */
    isAnomaly(latencyMs: number): boolean {
        if (this._count < this.minObservations) return false;
        // Also skip if stdDev is 0 (all identical values, no variance yet)
        if (this.stdDev === 0) return false;
        return latencyMs > this.threshold;
    }

    /**
     * Snapshot of current state for logging/alerting.
     */
    snapshot(): OuroborosSnapshot {
        return {
            ema: Math.round(this._ema * 100) / 100,
            emv: Math.round(this._emv * 100) / 100,
            stdDev: Math.round(this.stdDev * 100) / 100,
            threshold: Math.round(this.threshold * 100) / 100,
            observations: this._count,
        };
    }

    /**
     * Serialize state (for Redis persistence between cron runs).
     */
    serialize(): string {
        return JSON.stringify({ ema: this._ema, emv: this._emv, count: this._count });
    }

    /**
     * Restore state from a previously serialized snapshot.
     */
    restore(raw: string): void {
        try {
            const s = JSON.parse(raw) as { ema: number; emv: number; count: number };
            if (typeof s.ema === 'number') this._ema = s.ema;
            if (typeof s.emv === 'number') this._emv = s.emv;
            if (typeof s.count === 'number') this._count = s.count;
        } catch {
            // Corrupt state: reset silently
        }
    }
}
