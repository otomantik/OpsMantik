import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { getEntitlements } from '@/lib/entitlements/getEntitlements';
import { requireCapability, EntitlementError } from '@/lib/entitlements/requireEntitlement';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Response item shape: matches Google Ads offline conversion expectations.
 * Used by Google Ads Script (UrlFetchApp → parse → AdsApp upload).
 */
export interface GoogleAdsConversionItem {
  /** Queue row id for idempotency / ack (optional). */
  id: string;
  /** Google Click ID (preferred). */
  gclid: string;
  /** iOS web conversions. */
  wbraid: string;
  /** iOS app conversions. */
  gbraid: string;
  /** Conversion action name (e.g. "Sealed Lead"). */
  conversionName: string;
  /** Format: yyyy-MM-dd HH:mm:ssZ (e.g. 2026-02-22 14:30:00+00:00). */
  conversionTime: string;
  /** Value in currency units (converted from value_cents). */
  conversionValue: number;
  /** ISO currency code (e.g. TRY, USD). */
  conversionCurrency: string;
}

/**
 * GET /api/oci/google-ads-export?siteId=<uuid>&markAsExported=true
 *
 * "Ready-for-Google" Exit Valve: reads from offline_conversion_queue (status = QUEUED),
 * returns JSON formatted for Google Ads Script consumption.
 *
 * Auth: x-api-key must match OCI_API_KEY.
 * Optional: markAsExported=true → updates returned rows to PROCESSING so they are not re-fetched.
 */
export async function GET(req: NextRequest) {
  try {
    const apiKey = (req.headers.get('x-api-key') || '').trim();
    const envKey = (process.env.OCI_API_KEY || '').trim();
    const authed = Boolean(envKey) && timingSafeCompare(apiKey, envKey);

    if (!authed) {
      const clientId = RateLimitService.getClientId(req);
      await RateLimitService.checkWithMode(clientId, 10, 60 * 1000, {
        mode: 'fail-closed',
        namespace: 'oci-authfail',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const siteId = String(searchParams.get('siteId') || '');
    const markAsExported = searchParams.get('markAsExported') === 'true';
    const providerFilter = searchParams.get('providerKey') ?? 'google_ads';

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
    }

    const { data: site, error: siteError } = await adminClient
      .from('sites')
      .select('id, currency')
      .eq('id', siteId)
      .maybeSingle();

    if (siteError || !site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const entitlements = await getEntitlements(siteId, adminClient);
    try {
      requireCapability(entitlements, 'google_ads_sync');
    } catch (err) {
      if (err instanceof EntitlementError) {
        return NextResponse.json(
          { error: 'Forbidden', code: 'CAPABILITY_REQUIRED', capability: err.capability },
          { status: 403 }
        );
      }
      throw err;
    }

    const conversionName = (process.env.OCI_CONVERSION_NAME || 'Sealed Lead').trim();

    const query = adminClient
      .from('offline_conversion_queue')
      .select('id, gclid, wbraid, gbraid, conversion_time, value_cents, currency')
      .eq('site_id', siteId)
      .eq('status', 'QUEUED')
      .eq('provider_key', providerFilter)
      .order('created_at', { ascending: true });

    const { data: rows, error: fetchError } = await query;

    if (fetchError) {
      return NextResponse.json(
        { error: 'Failed to load queue', details: fetchError.message },
        { status: 500 }
      );
    }

    const list = Array.isArray(rows) ? rows : [];
    const idsToMark = list.map((r: { id: string }) => r.id);

    if (list.length === 0) {
      return NextResponse.json([]);
    }

    if (markAsExported && idsToMark.length > 0) {
      const { error: updateError } = await adminClient
        .from('offline_conversion_queue')
        .update({
          status: 'PROCESSING',
          claimed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .in('id', idsToMark)
        .eq('site_id', siteId)
        .eq('status', 'QUEUED');

      if (updateError) {
        return NextResponse.json(
          { error: 'Failed to mark as exported', details: updateError.message },
          { status: 500 }
        );
      }
    }

    const currency = (site as { currency?: string })?.currency || 'TRY';

    const conversions: GoogleAdsConversionItem[] = list.map((row: {
      id: string;
      gclid?: string | null;
      wbraid?: string | null;
      gbraid?: string | null;
      conversion_time: string;
      value_cents: number;
      currency?: string | null;
    }) => {
      const rawTime = row.conversion_time || '';
      const conversionTime = formatConversionTime(rawTime);
      const valueCents = Number(row.value_cents) || 0;
      const conversionValue = valueCents / 100;
      const rowCurrency = (row.currency || currency || 'TRY').trim();

      return {
        id: String(row.id),
        gclid: (row.gclid || '').trim(),
        wbraid: (row.wbraid || '').trim(),
        gbraid: (row.gbraid || '').trim(),
        conversionName,
        conversionTime,
        conversionValue: conversionValue >= 0 ? conversionValue : 0,
        conversionCurrency: rowCurrency,
      };
    });

    return NextResponse.json(conversions);
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}

/**
 * Format timestamptz/ISO string to Google Ads style: yyyy-MM-dd HH:mm:ssZ
 * (e.g. 2026-02-22 14:30:00+00:00).
 */
function formatConversionTime(isoOrEmpty: string): string {
  if (!isoOrEmpty || typeof isoOrEmpty !== 'string') {
    return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '+00:00');
  }
  const d = new Date(isoOrEmpty);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '+00:00');
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}+00:00`;
}
