import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { logInfo, logWarn, logError } from '@/lib/logging/logger';
import { WatchtowerService } from '@/lib/services/watchtower';
import { getBillingMetrics } from '@/lib/billing-metrics';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs'; // Force Node.js runtime for stability

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  try {
    const health = await WatchtowerService.runDiagnostics();

    if (health.status === 'alarm') {
      logError('WATCHTOWER_CRON_ALARM', { message: 'CRON DETECTED ALARM STATE' });
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
    const { data: ociMaintenanceHeartbeat } = await adminClient
      .from('cron_job_heartbeats')
      .select('last_status, last_rows_affected, run_count, last_error_message, last_finished_at')
      .eq('job_name', 'oci-maintenance')
      .maybeSingle();
    const ociMaintenancePartialSilent =
      ociMaintenanceHeartbeat?.last_status === 'PARTIAL' &&
      Number(ociMaintenanceHeartbeat?.last_rows_affected ?? 0) === 0 &&
      Number(ociMaintenanceHeartbeat?.run_count ?? 0) >= 3;

    if (ociMaintenancePartialSilent) {
      logError('WATCHTOWER_OCI_MAINTENANCE_PARTIAL_SILENT', {
        last_finished_at: ociMaintenanceHeartbeat?.last_finished_at ?? null,
        run_count: ociMaintenanceHeartbeat?.run_count ?? null,
        last_error_message: ociMaintenanceHeartbeat?.last_error_message ?? null,
      });
    }

    return NextResponse.json(
      {
        ok: !ociMaintenancePartialSilent && (health.status === 'ok' || health.status === 'degraded'),
        code: ociMaintenancePartialSilent ? 'WATCHTOWER_OCI_MAINTENANCE_PARTIAL_SILENT' : (codeByStatus[health.status] ?? 'WATCHTOWER_OK'),
        status: ociMaintenancePartialSilent ? 'alarm' : health.status,
        severity: ociMaintenancePartialSilent ? 'alarm' : health.status,
        failure_count: failureCount,
        checks: health.checks,
        details: health.details,
        oci_maintenance_partial_silent: ociMaintenancePartialSilent,
        billing_metrics: {
          ...billing,
          billing_reconciliation_drift_sites_last1h: driftCount,
        },
      },
      { headers: getBuildInfoHeaders() }
    );
  } catch (error) {
    logError('WATCHTOWER_CRON_FAILED', {
      error: error instanceof Error ? error.message : String(error),
    });
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
