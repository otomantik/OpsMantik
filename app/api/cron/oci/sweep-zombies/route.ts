import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { logInfo, logError, logWarn } from '@/lib/logging/logger';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { insertQueueTransitions, queueSnapshotPayloadToTransition } from '@/lib/oci/queue-transition-ledger';
import { OuroborosWatchdog } from '@/lib/oci/ouroboros-watchdog';
import { redis } from '@/lib/upstash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OUROBOROS_REDIS_KEY = 'ouroboros:ema:outbox';
const OUROBOROS_SAMPLE_WINDOW_HOURS = 2;

/**
 * GET/POST /api/cron/oci/sweep-zombies
 *
 * Self-healing routine for the OCI pipeline:
 * 0. Ouroboros Watchdog: EMA + 3σ anomaly detection on outbox processing times.
 * 1. Outbox: Resets PROCESSING events older than 10 mins back to PENDING.
 * 2. OCI Queue: Resets PROCESSING queue rows older than 10 mins to QUEUED.
 * 2.5. Signals: Resets PROCESSING signals older than 10 mins to PENDING.
 * 3. OCI Queue: Closes UPLOADED rows older than 48 hours as COMPLETED_UNVERIFIED.
 */
async function runSweep() {
    const stats = {
        outboxRescued: 0,
        queueRescued: 0,
        signalsRescued: 0,
        queueClosed: 0,
        ouroborosAnomaly: false as boolean | null,
        ouroborosSnapshot: null as Record<string, number> | null,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 0: OUROBOROS WATCHDOG — Predictive Degradation Detection
    // Queries recent outbox_events for processed_at - created_at latencies.
    // Runs BEFORE rescues so it can detect a degradation pattern early.
    // ─────────────────────────────────────────────────────────────────────────
    try {
        const windowStart = new Date(Date.now() - OUROBOROS_SAMPLE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

        const { data: recentEvents } = await adminClient
            .from('outbox_events')
            .select('created_at, processed_at')
            .eq('status', 'PROCESSED')
            .gte('processed_at', windowStart)
            .not('processed_at', 'is', null)
            .order('processed_at', { ascending: false })
            .limit(200);

        const watchdog = new OuroborosWatchdog({ alpha: 0.1, sigmaThreshold: 3, minObservations: 10 });

        // Restore persisted EMA state from Redis (continuity across cron runs)
        try {
            const savedState = await redis.get(OUROBOROS_REDIS_KEY);
            if (savedState && typeof savedState === 'string') {
                watchdog.restore(savedState);
            }
        } catch {
            // Redis unavailable — proceed without persisted state
        }

        // Feed historical latencies into the watchdog (oldest first for correct EMA order)
        const sorted = [...(recentEvents ?? [])].reverse();
        let lastLatencyMs = 0;
        for (const ev of sorted) {
            const created = new Date((ev as { created_at: string }).created_at).getTime();
            const processed = new Date((ev as { processed_at: string }).processed_at).getTime();
            if (Number.isFinite(created) && Number.isFinite(processed) && processed > created) {
                const latencyMs = processed - created;
                watchdog.observe(latencyMs);
                lastLatencyMs = latencyMs;
            }
        }

        const snap = watchdog.snapshot();
        stats.ouroborosSnapshot = snap as unknown as Record<string, number>;

        // Persist updated EMA state (30-minute TTL — spans 3 cron cycles)
        try {
            await redis.setex(OUROBOROS_REDIS_KEY, 1800, watchdog.serialize());
        } catch {
            // Non-critical
        }

        // Anomaly check: is the LATEST observed latency a 3σ outlier?
        if (lastLatencyMs > 0 && watchdog.isAnomaly(lastLatencyMs)) {
            stats.ouroborosAnomaly = true;
            logError('PREDICTIVE_DEGRADATION_HALT', {
                current_latency_ms: lastLatencyMs,
                ema_ms: snap.ema,
                std_dev_ms: snap.stdDev,
                threshold_ms: snap.threshold,
                observations: snap.observations,
                msg: 'Ouroboros: Processing time exceeded EMA + 3σ. Predictive degradation detected.',
            });

            // Alert: Post to Slack/PagerDuty webhook if configured
            const alertUrl = process.env.OUROBOROS_ALERT_WEBHOOK_URL;
            if (alertUrl) {
                void fetch(alertUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: [
                            '🔴 *PREDICTIVE_DEGRADATION_HALT*',
                            `OCI Outbox latency *${lastLatencyMs}ms* exceeded 3σ threshold (*${snap.threshold}ms*).`,
                            `EMA: ${snap.ema}ms | σ: ${snap.stdDev}ms | Observations: ${snap.observations}`,
                            'Ouroboros Watchdog triggered halt. Manual investigation required.',
                        ].join('\n'),
                    }),
                }).catch(() => { });
            }

            // Return early: do NOT rescue zombies during active degradation.
            // Rescuing during degradation could mask the root cause.
            return NextResponse.json(
                { ok: false, code: 'PREDICTIVE_DEGRADATION_HALT', stats },
                { status: 503, headers: getBuildInfoHeaders() }
            );
        }

        logInfo('ouroboros_clear', {
            ema_ms: snap.ema,
            std_dev_ms: snap.stdDev,
            threshold_ms: snap.threshold,
            observations: snap.observations,
        });
    } catch (err) {
        logWarn('ouroboros_watchdog_error', { error: err instanceof Error ? err.message : String(err) });
        // Watchdog failure is non-fatal — continue with sweep
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Outbox Zombie Sweeper
    // ─────────────────────────────────────────────────────────────────────────
    try {
        const { data: outboxRescued, error: outboxError } = await adminClient
            .from('outbox_events')
            .update({
                status: 'PENDING',
                last_error: 'Rescued by zombie sweeper (stuck in PROCESSING > 10m)'
            })
            .eq('status', 'PROCESSING')
            .lt('updated_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
            .select('id');

        if (outboxError) {
            logError('sweep_zombies_outbox_failed', { error: outboxError.message });
        } else {
            stats.outboxRescued = outboxRescued?.length ?? 0;
            if (stats.outboxRescued > 0) {
                logInfo('sweep_zombies_outbox_rescued', { count: stats.outboxRescued });
            }
        }
    } catch (err) {
        logError('sweep_zombies_outbox_error', { error: err instanceof Error ? err.message : String(err) });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: OCI Queue Zombie Sweeper (PROCESSING)
    // ─────────────────────────────────────────────────────────────────────────
    try {
        const rescueNow = new Date().toISOString();
        const { data: queueRescued, error: queueRescuedError } = await adminClient
            .from('offline_conversion_queue')
            .select('id')
            .eq('status', 'PROCESSING')
            .lt('updated_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
            ;

        if (queueRescuedError) {
            logError('sweep_zombies_queue_processing_failed', { error: queueRescuedError.message });
        } else {
            const rescuedRows = Array.isArray(queueRescued) ? queueRescued : [];
            stats.queueRescued = await insertQueueTransitions(
                adminClient,
                rescuedRows.map((row) => queueSnapshotPayloadToTransition(row.id, { status: 'QUEUED', updated_at: rescueNow }, 'SWEEPER'))
            );
            if (stats.queueRescued > 0) {
                logInfo('sweep_zombies_queue_processing_rescued', { count: stats.queueRescued });
            }
        }
    } catch (err) {
        logError('sweep_zombies_queue_error', { error: err instanceof Error ? err.message : String(err) });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2.5: OCI Signals Zombie Sweeper (PROCESSING)
    // ─────────────────────────────────────────────────────────────────────────
    try {
        const { data: signalsRescued, error: signalsError } = await adminClient
            .from('marketing_signals')
            .update({ dispatch_status: 'PENDING', updated_at: new Date().toISOString() })
            .eq('dispatch_status', 'PROCESSING')
            .lt('updated_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
            .select('id');

        if (signalsError) {
            logError('sweep_zombies_signals_failed', { error: signalsError.message });
        } else {
            stats.signalsRescued = signalsRescued?.length ?? 0;
            if (stats.signalsRescued > 0) {
                logInfo('sweep_zombies_signals_rescued', { count: stats.signalsRescued });
            }
        }
    } catch (err) {
        logError('sweep_zombies_signals_error', { error: err instanceof Error ? err.message : String(err) });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: OCI Queue — Close stale UPLOADED rows
    // ─────────────────────────────────────────────────────────────────────────
    try {
        const closeNow = new Date().toISOString();
        const { data: queueClosed, error: queueError } = await adminClient
            .from('offline_conversion_queue')
            .select('id')
            .eq('status', 'UPLOADED')
            .lt('updated_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
            ;

        if (queueError) {
            logError('sweep_zombies_queue_failed', { error: queueError.message });
        } else {
            const closedRows = Array.isArray(queueClosed) ? queueClosed : [];
            stats.queueClosed = await insertQueueTransitions(
                adminClient,
                closedRows.map((row) => queueSnapshotPayloadToTransition(row.id, { status: 'COMPLETED_UNVERIFIED', updated_at: closeNow }, 'SWEEPER'))
            );
            if (stats.queueClosed > 0) {
                logInfo('sweep_zombies_queue_closed', { count: stats.queueClosed });
            }
        }
    } catch (err) {
        logError('sweep_zombies_queue_close_error', { error: err instanceof Error ? err.message : String(err) });
    }

    return NextResponse.json(
        { ok: true, stats },
        { status: 200, headers: getBuildInfoHeaders() }
    );
}

export async function GET(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;
    return runSweep();
}

export async function POST(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;
    return runSweep();
}
