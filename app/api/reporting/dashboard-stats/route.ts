/**
 * Sprint 3: Server-side reporting route with noisy-neighbor protection and query timeout.
 * GET /api/reporting/dashboard-stats?siteId=...&from=...&to=...&ads_only=true
 * Auth: Cookie session. Returns 429 if site exceeds heavy-read concurrency; 504 on query timeout.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { withQueryTimeout } from '@/lib/utils/query-timeout';
import { getBuildInfoHeaders } from '@/lib/build-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QUERY_TIMEOUT_MS = 10_000; // 10s

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const siteId = req.nextUrl.searchParams.get('siteId');
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const adsOnly = req.nextUrl.searchParams.get('ads_only') !== 'false';

  if (!siteId) {
    return NextResponse.json({ error: 'siteId required' }, { status: 400 });
  }

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { allowed, release } = await RateLimitService.tryAcquireHeavyRead(siteId);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many concurrent reports. Please try again shortly.' },
      { status: 429, headers: { ...getBuildInfoHeaders(), 'Retry-After': '60' } }
    );
  }

  try {
    const dateFrom = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dateTo = to ? new Date(to) : new Date();

    const rpcPromise = supabase.rpc('get_dashboard_stats', {
      p_site_id: siteId,
      p_date_from: dateFrom.toISOString(),
      p_date_to: dateTo.toISOString(),
      p_ads_only: adsOnly,
    });

    const result = await withQueryTimeout(
      rpcPromise as unknown as Promise<{ data: Record<string, unknown>; error: { message: string } | null }>,
      QUERY_TIMEOUT_MS
    );
    const { data, error } = result;

    if (error) {
      const { logError } = await import('@/lib/logging/logger');
      logError('DASHBOARD_STATS_RPC_FAILED', { code: (error as { code?: string })?.code });
      return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
    }

    const rangeDays = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24));
    return NextResponse.json(
      { ...(data ?? {}), range_days: rangeDays },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const { logError } = await import('@/lib/logging/logger');
    logError('DASHBOARD_STATS_ERROR', { error: msg });
    if (msg.includes('QUERY_TIMEOUT')) {
      return NextResponse.json(
        { error: 'Report timed out. Try a shorter date range.', code: 'TIMEOUT' },
        { status: 504, headers: getBuildInfoHeaders() }
      );
    }
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  } finally {
    await release();
  }
}
