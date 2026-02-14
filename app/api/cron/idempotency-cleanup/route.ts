import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logInfo, logError } from '@/lib/logging/logger';

export const runtime = 'nodejs';

const BATCH_SIZE = 10_000;

/**
 * Returns YYYY-MM for (UTC now - N months). Used to never delete current/previous month.
 */
function getYearMonthUtcOffset(monthsAgo: number): string {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() - monthsAgo;
    const year = m <= 0 ? y - Math.ceil(-m / 12) : y;
    const month = ((m % 12) + 12) % 12;
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * POST /api/cron/idempotency-cleanup
 * Lifecycle: Delete ingest_idempotency rows older than 90 days, in batches of 10k.
 * Safety: Never deletes current or previous UTC month (RPC + dry_run count).
 * Auth: Cron Secret.
 * Schedule: Daily 03:00 UTC. Large backlogs may require multiple runs.
 */
export async function POST(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;

    const dryRun = req.nextUrl.searchParams.get('dry_run') === 'true';

    // 1. Cutoff = 90 days ago
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const cutoffIso = cutoffDate.toISOString();

    if (cutoffDate.getTime() > now.getTime() - 89 * 24 * 60 * 60 * 1000) {
        logError('CLEANUP_SAFETY_TRIGGERED', { cutoffIso, now: now.toISOString() });
        return NextResponse.json({ error: 'Safety check failed: Calculated cutoff is too recent.' }, { status: 500 });
    }

    // Keep only rows before (current month - 2) so we never touch current or previous month
    const keepAfterYearMonth = getYearMonthUtcOffset(2);

    logInfo('CLEANUP_START', { cutoffIso, dryRun, keep_after_year_month: keepAfterYearMonth });

    let deletedCount = 0;

    if (dryRun) {
        const { count, error } = await adminClient
            .from('ingest_idempotency')
            .select('*', { count: 'exact', head: true })
            .lt('created_at', cutoffIso)
            .lte('year_month', keepAfterYearMonth);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        deletedCount = count ?? 0;

        logInfo('CLEANUP_COMPLETE', { would_delete: deletedCount, dryRun: true });
        return NextResponse.json({
            ok: true,
            cutoff: cutoffIso,
            would_delete: deletedCount,
            dry_run: true,
            note: deletedCount > BATCH_SIZE ? `Multiple runs may be needed (batch size ${BATCH_SIZE}).` : undefined,
        }, { headers: getBuildInfoHeaders() });
    }

    const { data: deleted, error } = await adminClient.rpc('delete_expired_idempotency_batch', {
        p_cutoff_iso: cutoffIso,
        p_batch_size: BATCH_SIZE,
    });

    if (error) {
        logError('CLEANUP_FAIL', { error: error.message });
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    deletedCount = typeof deleted === 'number' ? deleted : 0;
    logInfo('CLEANUP_COMPLETE', { deleted: deletedCount, dryRun: false });

    return NextResponse.json({
        ok: true,
        cutoff: cutoffIso,
        deleted: deletedCount,
        dry_run: false,
        batch_size: BATCH_SIZE,
        note: deletedCount >= BATCH_SIZE ? `Backlog may remain; run again or schedule more frequently.` : undefined,
    }, { headers: getBuildInfoHeaders() });
}
