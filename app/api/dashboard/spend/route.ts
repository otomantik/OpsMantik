/**
 * GET /api/dashboard/spend — Daily ad spend for a site (Google Ads).
 * Requires site to have google_ads_spend module. Fail-closed 403 if not enabled.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { requireModule, ModuleNotEnabledError } from '@/lib/auth/require-module';
import { getBuildInfoHeaders } from '@/lib/build-info';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: getBuildInfoHeaders() }
    );
  }

  const siteId = req.nextUrl.searchParams.get('siteId');
  if (!siteId || typeof siteId !== 'string') {
    return NextResponse.json(
      { error: 'siteId is required' },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: getBuildInfoHeaders() }
    );
  }

  try {
    await requireModule({ siteId, requiredModule: 'google_ads_spend' });
  } catch (err) {
    if (err instanceof ModuleNotEnabledError) {
      return NextResponse.json(
        { error: 'Module not enabled', code: 'MODULE_NOT_ENABLED', module: 'google_ads_spend' },
        { status: 403, headers: getBuildInfoHeaders() }
      );
    }
    throw err;
  }

  const from = req.nextUrl.searchParams.get('from') ?? '';
  const to = req.nextUrl.searchParams.get('to') ?? '';

  let query = supabase
    .from('ad_spend_daily')
    .select('id, site_id, campaign_id, campaign_name, cost_cents, clicks, impressions, spend_date, updated_at')
    .eq('site_id', siteId)
    .order('spend_date', { ascending: false });

  if (from) query = query.gte('spend_date', from);
  if (to) query = query.lte('spend_date', to);

  const { data: rows, error } = await query.limit(500);

  if (error) {
    const { logError } = await import('@/lib/logging/logger');
    logError('DASHBOARD_SPEND_FAILED', { code: (error as { code?: string })?.code });
    return NextResponse.json(
      { error: 'Something went wrong', code: 'SERVER_ERROR' },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }

  return NextResponse.json(
    { data: rows ?? [], siteId },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}
