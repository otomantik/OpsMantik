import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';
import { calculateLeadValue } from '@/lib/valuation/calculator';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { getEntitlements } from '@/lib/entitlements/getEntitlements';
import { requireCapability, EntitlementError } from '@/lib/entitlements/requireEntitlement';
import { logError } from '@/lib/logging/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Parse OCI_API_KEYS "siteId:key,siteId:key" → Map<siteId, key>. Strict per-site scoping. */
function getOciApiKeysBySite(): Map<string, string> {
  const raw = process.env.OCI_API_KEYS?.trim();
  if (!raw) return new Map();
  const map = new Map<string, string>();
  for (const part of raw.split(',')) {
    const idx = part.indexOf(':');
    if (idx > 0) {
      const sid = part.slice(0, idx).trim();
      const key = part.slice(idx + 1).trim();
      if (sid && key) map.set(sid, key);
    }
  }
  return map;
}

/**
 * GET /api/oci/export-batch?siteId=<uuid>
 *
 * OCI "Pull" strategy: Google Ads Script calls this with x-api-key.
 * STRICT: x-api-key must match the key for the requested siteId (OCI_API_KEYS).
 * Falls back to OCI_API_KEY (single key) if OCI_API_KEYS not set (backward compat).
 */
export async function GET(req: NextRequest) {
  try {
    const apiKey = (req.headers.get('x-api-key') || '').trim();
    const { searchParams } = new URL(req.url);
    const siteId = String(searchParams.get('siteId') || '');

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId', code: 'VALIDATION_FAILED' }, { status: 400 });
    }

    // 1. SECURITY: Site-scoped API key (OCI_API_KEYS) or legacy single key (OCI_API_KEY)
    const keysBySite = getOciApiKeysBySite();
    const legacyKey = (process.env.OCI_API_KEY || '').trim();

    let authed = false;
    if (keysBySite.size > 0) {
      const expectedKey = keysBySite.get(siteId);
      if (!expectedKey) {
        return NextResponse.json({ error: 'Forbidden', code: 'SITE_KEY_MISMATCH' }, { status: 403 });
      }
      authed = timingSafeCompare(apiKey, expectedKey);
      if (!authed) {
        const clientId = RateLimitService.getClientId(req);
        await RateLimitService.checkWithMode(clientId, 10, 60 * 1000, {
          mode: 'fail-closed',
          namespace: 'oci-authfail',
        });
        return NextResponse.json({ error: 'Forbidden', code: 'SITE_KEY_MISMATCH' }, { status: 403 });
      }
    } else if (legacyKey) {
      authed = timingSafeCompare(apiKey, legacyKey);
    }

    if (!authed) {
      const clientId = RateLimitService.getClientId(req);
      await RateLimitService.checkWithMode(clientId, 10, 60 * 1000, {
        mode: 'fail-closed',
        namespace: 'oci-authfail',
      });
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    // 2. Site lookup
    const { data: site, error: siteError } = await adminClient
      .from('sites')
      .select('id, currency, default_deal_value')
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
        return NextResponse.json({ error: 'Forbidden', code: 'CAPABILITY_REQUIRED', capability: err.capability }, { status: 403 });
      }
      throw err;
    }

    const currency = (site as { currency?: string })?.currency || 'TRY';
    const siteDefaultValue = Number((site as { default_deal_value?: number | null }).default_deal_value) || 0;
    const { fromIso, toIso } = getTodayTrtUtcRange();

    // 3. Fetch calls (sealed only) with lead_score and sale_amount for proxy value
    const { data: calls, error: callsError } = await adminClient
      .from('calls')
      .select('id, created_at, confirmed_at, matched_session_id, click_id, oci_status, lead_score, sale_amount')
      .eq('site_id', siteId)
      .in('status', ['confirmed', 'qualified', 'real'])
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .or('oci_status.is.null,oci_status.eq.sealed,oci_status.eq.failed');

    if (callsError) {
      logError('OCI_EXPORT_BATCH_CALLS_FAILED', { code: (callsError as { code?: string })?.code });
      return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
    }

    const rows = Array.isArray(calls) ? calls : [];

    if (rows.length === 0) {
      return NextResponse.json([]);
    }

    // 4. SESSION EŞLEŞTİRME (GCLID/WBRAID/GBRAID)
    const sessionIds = Array.from(
      new Set(
        rows
          .map((r: { matched_session_id?: string | null }) => r.matched_session_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
      )
    );

    const sessionMap = new Map<
      string,
      { gclid?: string | null; wbraid?: string | null; gbraid?: string | null }
    >();

    if (sessionIds.length > 0) {
      const { data: sessions, error: sessError } = await adminClient
        .from('sessions')
        .select('id, gclid, wbraid, gbraid')
        .eq('site_id', siteId)
        .in('id', sessionIds);

      if (sessError) {
        logError('OCI_EXPORT_BATCH_SESSIONS_FAILED', { code: (sessError as { code?: string })?.code });
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
      }

      for (const s of sessions || []) {
        const row = s as { id: string; gclid?: string | null; wbraid?: string | null; gbraid?: string | null };
        sessionMap.set(String(row.id), {
          gclid: row.gclid ?? null,
          wbraid: row.wbraid ?? null,
          gbraid: row.gbraid ?? null,
        });
      }
    }

    // 5. Build JSON for Google Ads Script (with proxy conversion value)
    // Conversion name: Google Ads’teki Offline Conversion aksiyon adıyla birebir aynı olmalı.
    const conversionName = process.env.OCI_CONVERSION_NAME || 'Sealed Lead';

    const jsonOutput: Array<{
      gclid: string;
      gbraid: string;
      wbraid: string;
      conversion_name: string;
      conversion_time: string;
      value: number;
      currency: string;
    }> = [];

    for (const c of rows) {
      const row = c as {
        id: string;
        matched_session_id?: string | null;
        click_id?: string | null;
        confirmed_at?: string | null;
        created_at?: string | null;
        lead_score?: number | null;
        sale_amount?: number | null;
      };
      const sid = row.matched_session_id ? String(row.matched_session_id) : '';
      const sess = sid ? sessionMap.get(sid) : undefined;

      const gclid = (sess?.gclid || '').trim();
      const wbraid = (sess?.wbraid || '').trim();
      const gbraid = (sess?.gbraid || '').trim();
      const fallbackClick = (row.click_id || '').toString().trim();

      const hasAnyClickId = Boolean(gclid || wbraid || gbraid || fallbackClick);
      if (!hasAnyClickId) continue;

      // Proxy value: use sale_amount if set, else derive from lead_score + site default_deal_value
      const leadScore0to5 =
        row.lead_score != null && Number.isFinite(row.lead_score)
          ? Math.min(5, Math.max(0, Math.round(row.lead_score / 20)))
          : 3;
      const userPrice =
        row.sale_amount != null && Number.isFinite(row.sale_amount) && row.sale_amount > 0
          ? row.sale_amount
          : null;
      const conversionValue = calculateLeadValue(leadScore0to5, userPrice, siteDefaultValue);
      // Do not send 0 to Google for qualified leads (ROAS bidding fails)
      const value = conversionValue > 0 ? conversionValue : 1;

      const rawTime = String(row.confirmed_at || row.created_at || '');

      jsonOutput.push({
        gclid: gclid || fallbackClick || '',
        gbraid: gbraid || '',
        wbraid: wbraid || '',
        conversion_name: conversionName,
        conversion_time: rawTime,
        value,
        currency,
      });
    }

    return NextResponse.json(jsonOutput);
  } catch (e: unknown) {
    logError('OCI_EXPORT_BATCH_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  }
}
