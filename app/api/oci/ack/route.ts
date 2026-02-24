import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { getEntitlements } from '@/lib/entitlements/getEntitlements';
import { requireCapability, EntitlementError } from '@/lib/entitlements/requireEntitlement';
import { logWarn } from '@/lib/logging/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/oci/ack
 *
 * Two-phase commit ACK endpoint for OCI pull strategy.
 * The client (e.g., Google Ads Script) should call this AFTER it successfully uploads conversions.
 *
 * Auth: x-api-key must match OCI_API_KEY (same as export-batch).
 * Body: { site_id: string, call_ids: string[] }
 *
 * Side effect: Marks ONLY provided call_ids as oci_status='uploaded' (site-scoped).
 * Canonical conversion_sends increment: after successful UPDATE, increment_usage_checked.
 * On LIMIT: increment skip, structured warn log, 200 OK (ACK idempotent değil; 429 duplicate risk).
 */
export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get('x-api-key');
    const envKey = process.env.OCI_API_KEY;

    if (!envKey || apiKey !== envKey) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing API Key' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const siteId = typeof body?.site_id === 'string' ? body.site_id : '';
    const callIdsRaw = Array.isArray(body?.call_ids) ? body.call_ids : [];
    const callIds = callIdsRaw
      .map((x: unknown) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x: string) => x.length > 0);

    if (!siteId) {
      return NextResponse.json({ error: 'Missing site_id' }, { status: 400 });
    }
    if (callIds.length === 0) {
      return NextResponse.json({ error: 'Missing call_ids' }, { status: 400 });
    }

    const entitlements = await getEntitlements(siteId, adminClient);
    try {
      requireCapability(entitlements, 'google_ads_sync');
    } catch (err) {
      if (err instanceof EntitlementError) {
        return NextResponse.json({ error: 'Forbidden', code: 'CAPABILITY_REQUIRED', capability: err.capability }, { status: 403 });
      }
      throw err;
    }

    const nowIso = new Date().toISOString();
    const batchId = crypto.randomUUID();

    const { error } = await adminClient
      .from('calls')
      .update({
        oci_status: 'uploaded',
        oci_uploaded_at: nowIso,
        oci_status_updated_at: nowIso,
        oci_batch_id: batchId,
        oci_error: null,
      })
      .in('id', callIds)
      .eq('site_id', siteId);

    if (error) {
      return NextResponse.json(
        { error: 'ACK update failed', details: error.message },
        { status: 500 }
      );
    }

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const currentMonthStart = `${year}-${month}-01`;

    const { data: incResult, error: incError } = await adminClient.rpc('increment_usage_checked', {
      p_site_id: siteId,
      p_month: currentMonthStart,
      p_kind: 'conversion_sends',
      p_limit: entitlements.limits.monthly_conversion_sends,
    });

    if (incError) {
      logWarn('oci_ack_increment_error', { site_id: siteId, call_ids: callIds, error: incError.message });
    } else {
      const result = incResult as { ok?: boolean; reason?: string } | null;
      if (result && result.ok === false && result.reason === 'LIMIT') {
        logWarn('oci_ack_conversion_sends_limit', {
          site_id: siteId,
          call_ids: callIds,
          tier: entitlements.tier,
          limit: entitlements.limits.monthly_conversion_sends,
          reason: 'LIMIT',
          kind: 'conversion_sends',
        });
      }
    }

    return NextResponse.json({ ok: true, site_id: siteId, updated: callIds.length, batch_id: batchId });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}

