import { adminClient } from '@/lib/supabase/admin';
import { reconcileUsageForMonth, getCurrentYearMonthUTC } from '@/lib/reconciliation';
import { logInfo, logError } from '@/lib/logging/logger';
import { incrementBillingReconciliationRunOk, incrementBillingReconciliationRunFailed } from '@/lib/billing-metrics';

function previousYearMonth(yearMonth: string): string {
    const [y, m] = yearMonth.split('-').map(Number);
    if (m === 1) return `${y - 1}-12`;
    return `${y}-${String(m - 1).padStart(2, '0')}`;
}

export type EnqueueResult = {
    enqueued: number;
    active_sites: number;
    message?: string;
};

export type ProcessResult = {
    processed: number;
    completed: number;
    failed: number;
};

export const BillingReconciliationService = {
    /**
     * Finds active sites (recent ingest) and queues reconciliation jobs for current + previous month.
     */
    async enqueueActiveSites(): Promise<EnqueueResult> {
        const currentMonth = getCurrentYearMonthUTC();
        const prevMonth = previousYearMonth(currentMonth);
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // 1. Sites with activity in current month OR last 24h
        const { data: currentRows } = await adminClient
            .from('ingest_idempotency')
            .select('site_id')
            .eq('year_month', currentMonth)
            .limit(10000);

        const { data: recentRows } = await adminClient
            .from('ingest_idempotency')
            .select('site_id')
            .gte('created_at', twentyFourHoursAgo)
            .limit(10000);

        const siteIds = new Set<string>();
        currentRows?.forEach(r => r.site_id && siteIds.add(r.site_id));
        recentRows?.forEach(r => r.site_id && siteIds.add(r.site_id));

        if (siteIds.size === 0) {
            return { enqueued: 0, active_sites: 0, message: 'No active sites' };
        }

        const jobs = [];
        for (const siteId of siteIds) {
            jobs.push({ site_id: siteId, year_month: currentMonth });
            jobs.push({ site_id: siteId, year_month: prevMonth });
        }

        const { error } = await adminClient
            .from('billing_reconciliation_jobs')
            .upsert(jobs, { onConflict: 'site_id,year_month', ignoreDuplicates: true });

        if (error) throw new Error(`Enqueue failed: ${error.message}`);

        return { enqueued: jobs.length, active_sites: siteIds.size };
    },

    /**
     * Claims pending jobs and runs reconciliation logic.
     */
    async processPendingJobs(requestId?: string, limit: number = 50): Promise<ProcessResult> {
        const { data: rows, error: rpcError } = await adminClient.rpc('claim_billing_reconciliation_jobs', {
            p_limit: limit,
        });

        if (rpcError) throw new Error(`Claim failed: ${rpcError.message}`);

        const jobs = (rows ?? []) as { id: number; site_id: string; year_month: string }[];
        let processed = 0;
        let completed = 0;
        let failed = 0;

        for (const job of jobs) {
            processed++;
            try {
                const result = await reconcileUsageForMonth(job.site_id, job.year_month);

                logInfo('BILLING_RECONCILE_OK', {
                    code: 'BILLING_RECONCILE_OK',
                    site_id: job.site_id,
                    year_month: job.year_month,
                    billable_count: result.pg_count_billable,
                    overage_count: result.pg_count_overage,
                    drift_pct: result.drift?.pct,
                    request_id: requestId,
                });

                await adminClient
                    .from('billing_reconciliation_jobs')
                    .update({
                        status: 'COMPLETED',
                        last_error: null,
                        last_drift_pct: result.drift?.pct ?? null,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', job.id);

                incrementBillingReconciliationRunOk();
                completed++;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError('BILLING_RECONCILE_FAILED', {
                    code: 'BILLING_RECONCILE_FAILED',
                    site_id: job.site_id,
                    year_month: job.year_month,
                    last_error: message,
                    request_id: requestId,
                });

                await adminClient
                    .from('billing_reconciliation_jobs')
                    .update({
                        status: 'FAILED',
                        last_error: message.slice(0, 1000),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', job.id);

                incrementBillingReconciliationRunFailed();
                failed++;
            }
        }
        return { processed, completed, failed };
    }
};
