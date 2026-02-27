import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { calculateExpectedValue } from '@/lib/valuation/predictive-engine';
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
  /** Queue row id for idempotency / ack. */
  id: string;
  /** Sent as Order ID so Google Ads deduplicates by this value (same orderId → second upload ignored). */
  orderId: string;
  /** Google Click ID (preferred). */
  gclid: string;
  /** iOS web conversions. */
  wbraid: string;
  /** iOS app conversions. */
  gbraid: string;
  /** Conversion action name (e.g. "Sealed Lead"). */
  conversionName: string;
  /** Format: yyyy-mm-dd hh:mm:ss+0300 (Turkey Time). Do not use ISO with Z or milliseconds. */
  conversionTime: string;
  /** Numeric value only (e.g. 750.00). No currency symbols. */
  conversionValue: number;
  /** ISO currency code, e.g. TRY. */
  conversionCurrency: string;
}

/**
 * GET /api/oci/google-ads-export?siteId=<uuid>&markAsExported=true
 *
 * "Ready-for-Google" Exit Valve: reads from offline_conversion_queue (status = QUEUED or RETRY),
 * returns JSON formatted for Google Ads Script consumption.
 * RETRY = recovered from PROCESSING (e.g. script didn't ack); script re-uploads them.
 * One conversion per session: same matched_session_id → only earliest conversion_time is returned; others marked COMPLETED (skipped).
 *
 * Auth: x-api-key must match OCI_API_KEY (env on Vercel).
 * Optional: markAsExported=true → returned rows → PROCESSING; duplicate-session rows → COMPLETED (not re-exported).
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

    // Resolve site by id (UUID) or public_id (e.g. 32-char hex)
    let site: { id: string; currency?: string | null; oci_sync_method?: string | null; default_aov?: number | null; intent_weights?: any } | null = null;
    const byId = await adminClient.from('sites').select('id, currency, oci_sync_method, default_aov, intent_weights').eq('id', siteId).maybeSingle();
    if (byId.data) {
      site = byId.data as { id: string; currency?: string | null };
    }
    if (!site) {
      const byPublicId = await adminClient.from('sites').select('id, currency, oci_sync_method, default_aov, intent_weights').eq('public_id', siteId).maybeSingle();
      if (byPublicId.data) {
        site = byPublicId.data as { id: string; currency?: string | null; oci_sync_method?: string | null; default_aov?: number | null; intent_weights?: any };
      }
    }
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Explicit Partitioning: Export only works for sites configured as 'script'
    if (site.oci_sync_method === 'api') {
      return NextResponse.json(
        { error: 'Site partition mismatch', details: 'This site is configured for backend API sync, not script export.' },
        { status: 400 }
      );
    }

    const siteUuid = site.id;

    const entitlements = await getEntitlements(siteUuid, adminClient);
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
      .select('id, call_id, gclid, wbraid, gbraid, conversion_time, value_cents, currency, action')
      .eq('site_id', siteUuid)
      .in('status', ['QUEUED', 'RETRY'])
      .eq('provider_key', providerFilter)
      .order('created_at', { ascending: true });

    const { data: rows, error: fetchError } = await query;

    if (fetchError) {
      return NextResponse.json(
        { error: 'Failed to load queue', details: fetchError.message },
        { status: 500 }
      );
    }

    const rawList = Array.isArray(rows) ? rows : [];
    if (rawList.length === 0) {
      return NextResponse.json([]);
    }

    const callIds = rawList.map((r: { call_id: string | null }) => r.call_id).filter(Boolean) as string[];
    const sessionByCall: Record<string, string> = {};
    if (callIds.length > 0) {
      const { data: calls } = await adminClient
        .from('calls')
        .select('id, matched_session_id')
        .eq('site_id', siteUuid)
        .in('id', callIds);
      for (const c of calls ?? []) {
        const sid = (c as { matched_session_id?: string | null }).matched_session_id;
        if (sid) sessionByCall[(c as { id: string }).id] = sid;
      }
    }

    // One per session: keep earliest conversion_time per matched_session_id
    const byConversionTime = [...rawList].sort(
      (a, b) =>
        new Date((a as { conversion_time: string }).conversion_time).getTime() -
        new Date((b as { conversion_time: string }).conversion_time).getTime()
    );
    const seenSessions = new Set<string>();
    const list: typeof rawList = [];
    const skippedIds: string[] = [];
    for (const row of byConversionTime) {
      const sessionId = row.call_id ? sessionByCall[row.call_id] : null;
      if (!sessionId) {
        list.push(row);
        continue;
      }
      if (seenSessions.has(sessionId)) {
        skippedIds.push(row.id);
        continue;
      }
      seenSessions.add(sessionId);
      list.push(row);
    }

    const idsToMarkProcessing = list.map((r: { id: string }) => r.id);

    if (markAsExported && (idsToMarkProcessing.length > 0 || skippedIds.length > 0)) {
      const now = new Date().toISOString();
      if (idsToMarkProcessing.length > 0) {
        const { error: updateError } = await adminClient
          .from('offline_conversion_queue')
          .update({
            status: 'PROCESSING',
            claimed_at: now,
            updated_at: now,
          })
          .in('id', idsToMarkProcessing)
          .eq('site_id', siteUuid)
          .in('status', ['QUEUED', 'RETRY']);
        if (updateError) {
          return NextResponse.json(
            { error: 'Failed to mark as exported', details: updateError.message },
            { status: 500 }
          );
        }
      }
      if (skippedIds.length > 0) {
        await adminClient
          .from('offline_conversion_queue')
          .update({ status: 'COMPLETED', updated_at: now })
          .in('id', skippedIds)
          .eq('site_id', siteUuid)
          .in('status', ['QUEUED', 'RETRY']);
      }
    }

    const currency = (site as { currency?: string })?.currency || 'TRY';

    const conversions: GoogleAdsConversionItem[] = list.map((row: {
      id: string;
      call_id?: string | null;
      gclid?: string | null;
      wbraid?: string | null;
      gbraid?: string | null;
      conversion_time: string;
      value_cents: number;
      currency?: string | null;
      action?: string | null;
    }) => {
      const rawTime = row.conversion_time || '';
      const conversionTime = formatConversionTimeTurkey(rawTime);

      // Predictive Value Engine Integration
      const ev = calculateExpectedValue(site?.default_aov, site?.intent_weights, row.action);
      const conversionValue = ensureNumericValue(ev > 0 ? ev : (Number(row.value_cents) || 0) / 100);

      const conversionCurrency = ensureCurrencyCode(row.currency || currency || 'TRY');

      return {
        id: String(row.id),
        orderId: String(row.id),
        gclid: (row.gclid || '').trim(),
        wbraid: (row.wbraid || '').trim(),
        gbraid: (row.gbraid || '').trim(),
        conversionName,
        conversionTime,
        conversionValue,
        conversionCurrency,
      };
    });

    return NextResponse.json(conversions);
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}

/** Turkey timezone offset: +3 hours in ms. Do not use .toISOString() — Google Ads rejects 'Z' and milliseconds. */
const TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Format conversion time as yyyy-mm-dd hh:mm:ss+0300 (Turkey Time).
 * Input is stored as UTC; we convert to Turkey and append +0300.
 * Example: 2026-02-25 18:24:15+0300
 */
function formatConversionTimeTurkey(isoOrEmpty: string): string {
  if (!isoOrEmpty || typeof isoOrEmpty !== 'string') {
    return formatConversionTimeTurkey(new Date().toISOString());
  }
  const d = new Date(isoOrEmpty);
  if (Number.isNaN(d.getTime())) {
    return formatConversionTimeTurkey(new Date().toISOString());
  }
  const turkeyMs = d.getTime() + TURKEY_OFFSET_MS;
  const turkey = new Date(turkeyMs);
  const y = turkey.getUTCFullYear();
  const m = String(turkey.getUTCMonth() + 1).padStart(2, '0');
  const day = String(turkey.getUTCDate()).padStart(2, '0');
  const h = String(turkey.getUTCHours()).padStart(2, '0');
  const min = String(turkey.getUTCMinutes()).padStart(2, '0');
  const s = String(turkey.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}+0300`;
}

/** Ensure value is a number suitable for Conversion value (no currency symbols). Round to 2 decimals. */
function ensureNumericValue(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Ensure currency is a clean code (e.g. TRY). Strip non-alpha. */
function ensureCurrencyCode(raw: string): string {
  const code = String(raw || 'TRY').trim().toUpperCase().replace(/[^A-Z]/g, '');
  return code || 'TRY';
}
