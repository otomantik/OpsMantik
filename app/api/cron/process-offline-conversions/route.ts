/**
 * POST /api/cron/process-offline-conversions — claim and upload queued conversions (all or filtered providers).
 *
 * Uses single OCI runner (PR-C4): list groups → health gate → claim → upload → metrics + record_provider_outcome.
 * Query: provider_key? (optional), limit=50 (1..500).
 *
 * Auth: requireCronAuth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { runOfflineConversionRunner } from '@/lib/oci/runner';
import { DEFAULT_LIMIT_CRON, MAX_LIMIT_CRON } from '@/lib/oci/constants';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  const searchParams = req.nextUrl.searchParams;
  const providerKeyParam = searchParams.get('provider_key')?.trim() || null;
  let limit = DEFAULT_LIMIT_CRON;
  const limitParam = searchParams.get('limit');
  if (limitParam != null && limitParam !== '') {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= MAX_LIMIT_CRON) {
      limit = parsed;
    }
  }

  const result = await runOfflineConversionRunner({
    mode: 'cron',
    providerFilter: providerKeyParam,
    limit,
    logPrefix: '[process-offline-conversions]',
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }

  return NextResponse.json(
    { ok: true, processed: result.processed, completed: result.completed, failed: result.failed, retry: result.retry },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}
