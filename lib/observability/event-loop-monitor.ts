/**
 * Event-Loop Latency Monitor — Kernel-Level Observability
 *
 * Uses Node.js `perf_hooks.monitorEventLoopDelay` (histogram-based)
 * to detect event-loop stalls in real time. Zero overhead in production
 * — the histogram is maintained by libuv, not JavaScript.
 *
 * Usage:
 *   import { startEventLoopMonitor, getEventLoopSnapshot } from '@/lib/observability/event-loop-monitor';
 *   startEventLoopMonitor();          // call once at server startup
 *   const snapshot = getEventLoopSnapshot();  // call anytime for metrics
 *
 * Integration:
 *   - Call `startEventLoopMonitor()` from `instrumentation.ts`
 *   - Expose `getEventLoopSnapshot()` via `/api/health` or `/api/metrics`
 *   - Set EVENTLOOP_STALL_THRESHOLD_MS env var (default: 50ms)
 */

import { logWarn } from '@/lib/logging/logger';

// ── Types ───────────────────────────────────────────────────────────

export interface EventLoopSnapshot {
  /** Minimum event-loop delay in ms. */
  min_ms: number;
  /** Maximum event-loop delay in ms. */
  max_ms: number;
  /** Mean event-loop delay in ms. */
  mean_ms: number;
  /** 50th percentile (median) delay in ms. */
  p50_ms: number;
  /** 99th percentile delay in ms. */
  p99_ms: number;
  /** Standard deviation in ms. */
  stddev_ms: number;
  /** Whether any stalls exceeded the threshold since last reset. */
  stall_detected: boolean;
  /** Timestamp of this snapshot. */
  captured_at: string;
}

// ── State ───────────────────────────────────────────────────────────

let histogram: ReturnType<typeof import('perf_hooks').monitorEventLoopDelay> | null = null;
let stallThresholdMs = 50;
let checkIntervalHandle: ReturnType<typeof setInterval> | null = null;
let lastStallDetected = false;

// ── Public API ──────────────────────────────────────────────────────

/**
 * Start monitoring event-loop delay. Call once at server startup.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @param opts.resolution - Histogram resolution in ms (default: 10ms)
 * @param opts.checkIntervalMs - How often to check for stalls (default: 5000ms)
 * @param opts.stallThreshold - Stall threshold in ms from env or param (default: 50ms)
 */
export function startEventLoopMonitor(opts?: {
  resolution?: number;
  checkIntervalMs?: number;
  stallThreshold?: number;
}): void {
  if (histogram) return; // already running

  // Only available in Node.js (not Edge Runtime)
  let perfHooks: typeof import('perf_hooks');
  try {
    perfHooks = require('perf_hooks');
  } catch {
    // Edge runtime or browser — silently skip
    return;
  }

  if (typeof perfHooks.monitorEventLoopDelay !== 'function') return;

  const resolution = opts?.resolution ?? 10;
  const checkInterval = opts?.checkIntervalMs ?? 5_000;
  stallThresholdMs =
    opts?.stallThreshold ??
    (parseInt(process.env.EVENTLOOP_STALL_THRESHOLD_MS ?? '50', 10) || 50);

  histogram = perfHooks.monitorEventLoopDelay({ resolution });
  histogram.enable();

  // Periodic stall check
  checkIntervalHandle = setInterval(() => {
    if (!histogram) return;
    const p99 = nsToMs(histogram.percentile(99));
    const max = nsToMs(histogram.max);

    if (max > stallThresholdMs) {
      lastStallDetected = true;
      logWarn('EVENTLOOP_STALL_DETECTED', {
        max_ms: round(max),
        p99_ms: round(p99),
        threshold_ms: stallThresholdMs,
        mean_ms: round(nsToMs(histogram.mean)),
      });
    } else {
      lastStallDetected = false;
    }

    // Reset histogram after each check interval so we only see recent stalls
    histogram.reset();
  }, checkInterval);

  // Don't keep the process alive just for monitoring
  if (checkIntervalHandle && typeof checkIntervalHandle === 'object' && 'unref' in checkIntervalHandle) {
    checkIntervalHandle.unref();
  }
}

/**
 * Get a point-in-time snapshot of event-loop delay metrics.
 * Returns null if monitoring hasn't been started.
 */
export function getEventLoopSnapshot(): EventLoopSnapshot | null {
  if (!histogram) return null;

  return {
    min_ms: round(nsToMs(histogram.min)),
    max_ms: round(nsToMs(histogram.max)),
    mean_ms: round(nsToMs(histogram.mean)),
    p50_ms: round(nsToMs(histogram.percentile(50))),
    p99_ms: round(nsToMs(histogram.percentile(99))),
    stddev_ms: round(nsToMs(histogram.stddev)),
    stall_detected: lastStallDetected,
    captured_at: new Date().toISOString(),
  };
}

/**
 * Stop monitoring. Cleans up the histogram and interval.
 * Safe to call even if monitoring was never started.
 */
export function stopEventLoopMonitor(): void {
  if (checkIntervalHandle) {
    clearInterval(checkIntervalHandle);
    checkIntervalHandle = null;
  }
  if (histogram) {
    histogram.disable();
    histogram = null;
  }
  lastStallDetected = false;
}

// ── Helpers ─────────────────────────────────────────────────────────

function nsToMs(ns: number): number {
  return ns / 1e6;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
