/**
 * PR-8: Billing observability — expose billing counters + drift.
 * GET /api/metrics — protected by cron auth OR admin. Returns JSON with billing counters and drift (from DB).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getBillingMetrics } from '@/lib/billing-metrics';
import { WatchtowerService } from '@/lib/services/watchtower';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (requireCronAuth(req) === null) {
    /* allowed: cron */
  } else if ((await requireAdmin()) === null) {
    /* allowed: admin */
  } else {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const billing = getBillingMetrics();
    const driftSitesLast1h = await WatchtowerService.checkBillingReconciliationDriftLast1h();

    const body = {
      billing_ingest_allowed_total: billing.billing_ingest_allowed_total,
      billing_ingest_duplicate_total: billing.billing_ingest_duplicate_total,
      billing_ingest_rejected_quota_total: billing.billing_ingest_rejected_quota_total,
      billing_ingest_rate_limited_total: billing.billing_ingest_rate_limited_total,
      billing_ingest_overage_total: billing.billing_ingest_overage_total,
      billing_ingest_degraded_total: billing.billing_ingest_degraded_total,
      billing_reconciliation_runs_ok_total: billing.billing_reconciliation_runs_ok_total,
      billing_reconciliation_runs_failed_total: billing.billing_reconciliation_runs_failed_total,
      billing_reconciliation_drift_sites_last1h: driftSitesLast1h >= 0 ? driftSitesLast1h : null,
    };

    return NextResponse.json(body, { headers: getBuildInfoHeaders() });
  } catch (err) {
    return NextResponse.json(
      { error: 'Metrics failed', details: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
