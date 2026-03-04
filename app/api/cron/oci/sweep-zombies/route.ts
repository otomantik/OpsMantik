import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { logInfo, logError } from '@/lib/logging/logger';
import { getBuildInfoHeaders } from '@/lib/build-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/cron/oci/sweep-zombies
 * 
 * Self-healing routine for the OCI pipeline:
 * 1. Outbox: Resets PROCESSING events older than 10 mins back to PENDING.
 * 2. OCI Queue: Closes UPLOADED rows older than 48 hours as COMPLETED_UNVERIFIED.
 */
async function runSweep() {
    const stats = {
        outboxRescued: 0,
        queueRescued: 0,
        signalsRescued: 0,
        queueClosed: 0,
    };

    try {
        // 1. Outbox Zombie Sweeper
        // If a worker crashes or OOMs during processing, rows get stuck in PROCESSING.
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

        // 2. OCI Queue Zombie Sweeper (PROCESSING)
        // If a script marks as exported but dies before ACK, rows stick in PROCESSING.
        // We reset them to QUEUED for the next script run.
        const { data: queueRescued, error: queueRescuedError } = await adminClient
            .from('offline_conversion_queue')
            .update({
                status: 'QUEUED',
                updated_at: new Date().toISOString()
            })
            .eq('status', 'PROCESSING')
            .lt('updated_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
            .select('id');

        if (queueRescuedError) {
            logError('sweep_zombies_queue_processing_failed', { error: queueRescuedError.message });
        } else {
            stats.queueRescued = queueRescued?.length ?? 0;
            if (stats.queueRescued > 0) {
                logInfo('sweep_zombies_queue_processing_rescued', { count: stats.queueRescued });
            }
        }

        // 2.5 OCI Signals Zombie Sweeper (PROCESSING)
        // Phase 6.1: Rescue signals that were exported but never ACKed.
        const { data: signalsRescued, error: signalsError } = await adminClient
            .from('marketing_signals')
            .update({
                dispatch_status: 'PENDING',
                updated_at: new Date().toISOString()
            })
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

        // 3. OCI Queue Zombie Sweeper (UPLOADED)
        // Handle ACK failures from Google Ads Script. If UPLOADED but not ACKed for 48h, mark as COMPLETED_UNVERIFIED.
        // CRITICAL Phase 6.3: QUARANTINE rows are untouchable.
        const { data: queueClosed, error: queueError } = await adminClient
            .from('offline_conversion_queue')
            .update({
                status: 'COMPLETED_UNVERIFIED',
                updated_at: new Date().toISOString()
            })
            .eq('status', 'UPLOADED')
            .lt('updated_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
            .select('id');

        if (queueError) {
            logError('sweep_zombies_queue_failed', { error: queueError.message });
        } else {
            stats.queueClosed = queueClosed?.length ?? 0;
            if (stats.queueClosed > 0) {
                logInfo('sweep_zombies_queue_closed', { count: stats.queueClosed });
            }
        }

        return NextResponse.json(
            { ok: true, stats },
            { status: 200, headers: getBuildInfoHeaders() }
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError('sweep_zombies_error', { error: msg });
        return NextResponse.json(
            { ok: false, error: msg },
            { status: 500, headers: getBuildInfoHeaders() }
        );
    }
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
