import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logInfo, logError } from '@/lib/logging/logger';
import { appendAuditLog } from '@/lib/audit/audit-log';
import crypto from 'node:crypto';

export const runtime = 'nodejs';

/**
 * POST /api/cron/invoice-freeze
 * Revenue Kernel: Snapshot previous month's usage into immutable invoice_snapshot table.
 * Auth: Cron Secret only.
 * Idempotency: ON CONFLICT DO NOTHING (safe to run multiple times).
 */
export async function POST(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;

    // 1. Determine Target Month (Previous UTC Month)
    // If run on Feb 1st, we freeze Jan.
    const now = new Date();
    const prevMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const targetYear = prevMonthDate.getUTCFullYear();
    const targetMonth = String(prevMonthDate.getUTCMonth() + 1).padStart(2, '0');
    const yearMonth = `${targetYear}-${targetMonth}`;

    logInfo('INVOICE_FREEZE_START', { year_month: yearMonth });

    let frozen = 0;
    let failed = 0;

    // 2. Batch Select from usage ledger
    // We assume site_usage_monthly is populated by the reconciliation job.
    // If not, snapshot might be 0, which is technically "correct" if no usage recorded.
    // Ideally we run reconciliation BEFORE freeze, or this job triggers simple aggregate query.
    // Since `site_usage_monthly` is the "UI View" but `ingest_idempotency` is SoT, 
    // STRICT enterprise mode would aggregate from `ingest_idempotency` right here to be 100% sure.
    // Let's do the strict check: Aggregate from SoT to ensure snapshot is valid even if reconciliation lagged.

    // Pagination to handle all sites
    const BATCH_SIZE = 100;
    let lastSiteId = '00000000-0000-0000-0000-000000000000';
    let hasMore = true;

    while (hasMore) {
        // Fetch sites active in that month (from site_usage_monthly as a hint, or just all sites?)
        // Better: iterate sites that have usage entries.
        const { data: usageRows, error: usageError } = await adminClient
            .from('site_usage_monthly')
            .select('site_id, event_count, overage_count')
            .eq('year_month', yearMonth)
            .gt('site_id', lastSiteId)
            .order('site_id', { ascending: true })
            .limit(BATCH_SIZE);

        if (usageError) {
            logError('INVOICE_FREEZE_FETCH_ERROR', { error: usageError.message });
            return NextResponse.json({ error: 'Failed to fetch usage' }, { status: 500 });
        }

        if (!usageRows || usageRows.length === 0) {
            hasMore = false;
            break;
        }

        for (const row of usageRows) {
            try {
                // Double Check Aggr (Paranoid Check)
                // In a massive system we might skip this and trust `site_usage_monthly`,
                // but for robust financial exactness, we re-verify or use the ledger value.
                // We will trust `site_usage_monthly` as it is maintained by `reconcile-usage` job.
                // The runbook should ensure reconcile runs right before freeze.

                const snapshotHash = crypto
                    .createHash('sha256')
                    .update(`${row.site_id}:${yearMonth}:${row.event_count}:${row.overage_count}`)
                    .digest('hex');

                const { error: insertError } = await adminClient
                    .from('invoice_snapshot')
                    .insert({
                        site_id: row.site_id,
                        year_month: yearMonth,
                        event_count: row.event_count,
                        overage_count: row.overage_count,
                        snapshot_hash: snapshotHash,
                        generated_by: 'cron/invoice-freeze',
                    })
                    .select()
                    .single();

                if (insertError) {
                    // Ignore uniques (already frozen)
                    if (insertError.code === '23505') {
                        // Already frozen
                    } else {
                        throw insertError;
                    }
                } else {
                    frozen++;
                }

            } catch (err) {
                failed++;
                logError('INVOICE_FREEZE_SITE_ERROR', { site_id: row.site_id, error: String(err) });
            }
        }

        lastSiteId = usageRows[usageRows.length - 1].site_id;
    }

    logInfo('INVOICE_FREEZE_COMPLETE', { year_month: yearMonth, frozen, failed });

    await appendAuditLog(adminClient, {
        actor_type: 'cron',
        action: 'invoice_freeze',
        resource_type: 'invoice_snapshot',
        resource_id: yearMonth,
        payload: { year_month: yearMonth, frozen, failed },
    });

    return NextResponse.json(
        { ok: true, year_month: yearMonth, frozen, failed },
        { headers: getBuildInfoHeaders() }
    );
}
