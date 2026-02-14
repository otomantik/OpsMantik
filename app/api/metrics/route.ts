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
