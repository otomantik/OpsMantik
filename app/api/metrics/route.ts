import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { getBillingMetrics, getBillingMetricsFromRedis } from '@/lib/billing-metrics';
import { WatchtowerService } from '@/lib/services/watchtower';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs'; // or 'edge' if billing-metrics supports it, but watchtower uses adminClient which assumes node usually

/**
 * GET /api/metrics
 * Observability: Expose internal billing metrics and system health.
 * Billing ingest counters: from Redis (persistent, cross-instance) when available; else in-memory fallback.
 * Auth: Cron Secret or Cloudwatch Agent (via Bearer).
 */
export async function GET(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;

    // 1. Billing ingest metrics: Redis (persistent, cross-instance) or in-memory fallback
    const redisMetrics = await getBillingMetricsFromRedis();
    const ingestMetrics = redisMetrics ?? getBillingMetrics();

    // 2. DB Metrics (Reconciliation)
    // Get last 24h stats
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: runs } = await adminClient
        .from('billing_reconciliation_jobs')
        .select('status, last_drift_pct')
        .gte('updated_at', oneDayAgo);

    const runsOk = runs?.filter(r => r.status === 'COMPLETED').length || 0;
    const runsFailed = runs?.filter(r => r.status === 'FAILED').length || 0;
    const driftSites = runs?.filter(r => r.last_drift_pct && r.last_drift_pct > 0.01).length || 0;

    // 3. Watchtower Health
    const watchtower = await WatchtowerService.runDiagnostics();

    // 4. Funnel Kernel shadow metrics (when tables exist)
    let funnelKernel: Record<string, unknown> | null = null;
    try {
        const { count: ledgerCount } = await adminClient
            .from('call_funnel_ledger')
            .select('*', { count: 'exact', head: true });
        const { count: projCount } = await adminClient
            .from('call_funnel_projection')
            .select('*', { count: 'exact', head: true });
        const { count: projReadyCount } = await adminClient
            .from('call_funnel_projection')
            .select('*', { count: 'exact', head: true })
            .eq('export_status', 'READY');
        const { count: msCount } = await adminClient
            .from('marketing_signals')
            .select('*', { count: 'exact', head: true });
        const { count: queueCount } = await adminClient
            .from('offline_conversion_queue')
            .select('*', { count: 'exact', head: true })
            .in('status', ['QUEUED', 'RETRY']);
        const { count: violationCount } = await adminClient
            .from('funnel_invariant_violations')
            .select('*', { count: 'exact', head: true })
            .is('resolved_at', null);
        const { count: blockedCount } = await adminClient
            .from('call_funnel_projection')
            .select('*', { count: 'exact', head: true })
            .eq('export_status', 'BLOCKED');
        funnelKernel = {
            ledger_count: ledgerCount ?? 0,
            projection_count: projCount ?? 0,
            projection_ready_count: projReadyCount ?? 0,
            legacy_ms_count: msCount ?? 0,
            legacy_queue_queued_retry: queueCount ?? 0,
            open_violations: violationCount ?? 0,
            blocked_incomplete_funnel_count: blockedCount ?? 0,
        };
    } catch {
        funnelKernel = { status: 'tables_unavailable' };
    }

    const metrics = {
        billing: {
            ingest: ingestMetrics,
            ingest_source: redisMetrics ? 'redis' : 'memory',
            reconciliation: {
                runs_last_24h: runsOk + runsFailed,
                runs_ok: runsOk,
                runs_failed: runsFailed,
                drift_sites_last_24h: driftSites
            }
        },
        watchtower: {
            status: watchtower.status,
            checks: watchtower.checks
        },
        funnel_kernel: funnelKernel,
        meta: {
            timestamp: new Date().toISOString(),
            env: process.env.NODE_ENV
        }
    };

    return NextResponse.json(metrics, {
        headers: {
            ...getBuildInfoHeaders(),
            'Cache-Control': 'no-store'
        }
    });
}
