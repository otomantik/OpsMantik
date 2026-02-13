import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { WatchtowerService } from '@/lib/services/watchtower';
import { getBillingMetrics } from '@/lib/billing-metrics';

export const runtime = 'nodejs'; // Force Node.js runtime for stability

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  try {
    const health = await WatchtowerService.runDiagnostics();

    if (health.status === 'alarm') {
      console.error('[WATCHTOWER] CRON DETECTED ALARM STATE');
    }

    const requestId = req.headers.get('x-request-id') ?? undefined;
    const sessionsCount = health.checks.sessionsLastHour.count;
    const gclidCount = health.checks.gclidLast3Hours.count;
    const failureCount = health.checks.ingestPublishFailuresLast15m.count;

    if (failureCount > 0) {
      logWarn('INGEST_PIPELINE_DEGRADED', {
        code: 'INGEST_PUBLISH_FAILURE',
        failure_count: failureCount,
        request_id: requestId,
      });
    } else if (failureCount === -1) {
      logWarn('INGEST_PIPELINE_DEGRADED', {
        code: 'INGEST_CHECK_UNKNOWN',
        failure_count: -1,
        request_id: requestId,
      });
    }

    logInfo('WATCHTOWER_OK', {
      request_id: requestId,
      sessionsLastHour: sessionsCount,
      gclidLast3Hours: gclidCount,
      ingestPublishFailuresLast15m: failureCount,
      status: health.status,
    });

    const codeByStatus: Record<string, string> = {
      ok: 'WATCHTOWER_OK',
      degraded: 'WATCHTOWER_DEGRADED',
      alarm: 'WATCHTOWER_ALARM',
      critical: 'WATCHTOWER_CRITICAL',
    };

    const billing = getBillingMetrics();
    const driftCount = health.checks.billingReconciliationDriftLast1h.count;

    return NextResponse.json(
      {
        ok: health.status === 'ok' || health.status === 'degraded',
        code: codeByStatus[health.status] ?? 'WATCHTOWER_OK',
        status: health.status,
        severity: health.status,
        failure_count: failureCount,
        checks: health.checks,
        details: health.details,
        billing_metrics: {
          ...billing,
          billing_reconciliation_drift_sites_last1h: driftCount,
        },
      },
      { headers: getBuildInfoHeaders() }
    );
  } catch (error) {
    console.error('[WATCHTOWER] Cron execution failed:', error);
    return NextResponse.json(
      {
        ok: false,
        status: 'error',
        message: 'Watchtower execution failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
