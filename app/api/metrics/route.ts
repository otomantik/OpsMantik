import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { getBillingMetrics, getBillingMetricsFromRedis } from '@/lib/billing-metrics';
import { WatchtowerService } from '@/lib/services/watchtower';
import { adminClient } from '@/lib/supabase/admin';
import {
    computeApproxErrorRate,
    getRouteMetricsFromRedis,
    getRouteMetricsMemory,
} from '@/lib/route-metrics';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { getRefactorMetricsFromRedis, getRefactorMetricsMemory } from '@/lib/refactor/metrics';
import { REFACTOR_PHASE_TAG } from '@/lib/version';

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

    const routeRedis = await getRouteMetricsFromRedis();
    const routeMem = getRouteMetricsMemory();
    const routeSource = routeRedis ? 'redis' : 'memory';
    const routeCombined = routeRedis ?? routeMem;

    const refactorRedis = await getRefactorMetricsFromRedis();
    const refactorMetrics = refactorRedis ?? getRefactorMetricsMemory();
    const refactorMetricsSource = refactorRedis ? 'redis' : 'memory';

    let truthEvidenceLedger: Record<string, unknown> | null = null;
    try {
        const { count } = await adminClient
            .from('truth_evidence_ledger')
            .select('*', { count: 'exact', head: true });
        truthEvidenceLedger = { row_count: count ?? 0 };
    } catch {
        truthEvidenceLedger = { status: 'tables_unavailable' };
    }

    let truthCanonicalLedger: Record<string, unknown> | null = null;
    try {
        const { count } = await adminClient
            .from('truth_canonical_ledger')
            .select('*', { count: 'exact', head: true });
        truthCanonicalLedger = { row_count: count ?? 0 };
    } catch {
        truthCanonicalLedger = { status: 'tables_unavailable' };
    }

    let truthInferenceRuns: Record<string, unknown> | null = null;
    try {
        const { count } = await adminClient
            .from('truth_inference_runs')
            .select('*', { count: 'exact', head: true });
        truthInferenceRuns = { row_count: count ?? 0 };
    } catch {
        truthInferenceRuns = { status: 'tables_unavailable' };
    }

    let truthIdentityGraphEdges: Record<string, unknown> | null = null;
    try {
        const { count } = await adminClient
            .from('truth_identity_graph_edges')
            .select('*', { count: 'exact', head: true });
        truthIdentityGraphEdges = { row_count: count ?? 0 };
    } catch {
        truthIdentityGraphEdges = { status: 'tables_unavailable' };
    }
    const syncRate = computeApproxErrorRate('sync', routeCombined);
    const ceRate = computeApproxErrorRate('call_event_v2', routeCombined);

    const metrics = {
        routes: {
            source: routeSource,
            sync: {
                counters: {
                    requests_total: routeCombined.route_sync_requests_total ?? 0,
                    http_2xx: routeCombined.route_sync_http_2xx ?? 0,
                    http_3xx: routeCombined.route_sync_http_3xx ?? 0,
                    http_4xx: routeCombined.route_sync_http_4xx ?? 0,
                    http_5xx: routeCombined.route_sync_http_5xx ?? 0,
                },
                approx_server_error_rate: syncRate.error_rate,
                note: 'Monotonic counters since process start or Redis key TTL; use deltas or Vercel logs for 15m windows.',
            },
            call_event_v2: {
                counters: {
                    requests_total: routeCombined.route_call_event_v2_requests_total ?? 0,
                    http_2xx: routeCombined.route_call_event_v2_http_2xx ?? 0,
                    http_3xx: routeCombined.route_call_event_v2_http_3xx ?? 0,
                    http_4xx: routeCombined.route_call_event_v2_http_4xx ?? 0,
                    http_5xx: routeCombined.route_call_event_v2_http_5xx ?? 0,
                },
                approx_server_error_rate: ceRate.error_rate,
                note: 'Same as sync; 204 consent-missing counts as 2xx.',
            },
        },
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
        truth_refactor: {
            phase_tag: REFACTOR_PHASE_TAG,
            flags: getRefactorFlags(),
            metrics_source: refactorMetricsSource,
            metrics: refactorMetrics,
            truth_evidence_ledger: truthEvidenceLedger,
            truth_canonical_ledger: truthCanonicalLedger,
            truth_inference_runs: truthInferenceRuns,
            truth_identity_graph_edges: truthIdentityGraphEdges,
        },
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
