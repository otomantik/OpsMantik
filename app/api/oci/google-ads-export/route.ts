import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { formatGoogleAdsTimeCompact } from '@/lib/utils/format-google-ads-time';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/domain/mizan-mantik';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { verifySessionToken } from '@/lib/oci/session-auth';
import { getEntitlements } from '@/lib/entitlements/getEntitlements';
import { requireCapability, EntitlementError } from '@/lib/entitlements/requireEntitlement';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { redis } from '@/lib/upstash';
import type { SiteValuationRow } from '@/lib/oci/oci-config';

const PV_BATCH_MAX = 500;

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
  /** Format: yyyyMMdd HHmmss (site timezone; no offset). Google Ads uses account timezone. */
  conversionTime: string;
  /** Numeric value only (e.g. 750.00). No currency symbols. */
  conversionValue: number;
  /** ISO currency code, e.g. TRY. */
  conversionCurrency: string;
}

/**
 * GET /api/oci/google-ads-export?siteId=<uuid>&markAsExported=true
 *
 * Dual-Pipeline: reads from BOTH offline_conversion_queue (Seals) AND marketing_signals (Observation).
 * Returns JSON for Google Ads Script. IDs prefixed: seal_<uuid> | signal_<uuid> for ACK routing.
 * Auth: Bearer session_token or x-api-key. Optional markAsExported → queue rows → PROCESSING.
 */
export async function GET(req: NextRequest) {
  try {
    const bearer = (req.headers.get('authorization') || '').trim();
    const sessionToken = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '';
    const apiKey = (req.headers.get('x-api-key') || '').trim();
    const envKey = (process.env.OCI_API_KEY || '').trim();

    let authed = false;
    let siteIdFromAuth = '';

    if (sessionToken) {
      const parsed = verifySessionToken(sessionToken);
      if (parsed) {
        authed = true;
        siteIdFromAuth = parsed.siteId;
      }
    }
    if (!authed && envKey && timingSafeCompare(apiKey, envKey)) {
      authed = true;
    }

    if (!authed) {
      const clientId = RateLimitService.getClientId(req);
      await RateLimitService.checkWithMode(clientId, 10, 60 * 1000, {
        mode: 'fail-closed',
        namespace: 'oci-authfail',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const siteIdParam = String(searchParams.get('siteId') || '');
    const siteId = siteIdFromAuth || siteIdParam;
    const markAsExported = searchParams.get('markAsExported') === 'true';
    const providerFilter = searchParams.get('providerKey') ?? 'google_ads';

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
    }

    // Resolve site by id (UUID) or public_id (e.g. 32-char hex)
    let site: (SiteValuationRow & { id: string; public_id?: string | null; currency?: string | null; timezone?: string | null; oci_sync_method?: string | null }) | null = null;
    const byId = await adminClient.from('sites').select('id, public_id, currency, timezone, oci_sync_method, default_aov, intent_weights').eq('id', siteId).maybeSingle();
    if (byId.data) {
      site = byId.data as SiteValuationRow & { id: string; public_id?: string | null; currency?: string | null; timezone?: string | null; oci_sync_method?: string | null };
    }
    if (!site) {
      const byPublicId = await adminClient.from('sites').select('id, public_id, currency, timezone, oci_sync_method, default_aov, intent_weights').eq('public_id', siteId).maybeSingle();
      if (byPublicId.data) {
        site = byPublicId.data as SiteValuationRow & { id: string; public_id?: string | null; currency?: string | null; timezone?: string | null; oci_sync_method?: string | null };
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

    const query = adminClient
      .from('offline_conversion_queue')
      .select('id, call_id, gclid, wbraid, gbraid, conversion_time, created_at, value_cents, currency, action')
      .eq('site_id', siteUuid)
      .in('status', ['QUEUED', 'RETRY'])
      .eq('provider_key', providerFilter)
      .order('created_at', { ascending: true });

    const { data: rows, error: fetchError } = await query;

    if (fetchError) {
      const { logError } = await import('@/lib/logging/logger');
      logError('OCI_GOOGLE_ADS_EXPORT_QUEUE_FAILED', { code: (fetchError as { code?: string })?.code });
      return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
    }

    const rawList = Array.isArray(rows) ? rows : [];

    // Pipeline B: marketing_signals (PENDING)
    const { data: signalRows } = await adminClient
      .from('marketing_signals')
      .select('id, call_id, signal_type, google_conversion_name, google_conversion_time, conversion_value')
      .eq('site_id', siteUuid)
      .eq('dispatch_status', 'PENDING')
      .order('created_at', { ascending: true });

    const signalList = Array.isArray(signalRows) ? signalRows : [];

    // Resolve gclid for signals (only include those with click ID)
    const signalItems: GoogleAdsConversionItem[] = [];
    for (const sig of signalList) {
      const callId = (sig as { call_id?: string | null }).call_id;
      if (!callId) continue;
      const source = await getPrimarySource(siteUuid, { callId });
      const gclid = (source?.gclid || '').trim();
      const wbraid = (source?.wbraid || '').trim();
      const gbraid = (source?.gbraid || '').trim();
      const clickId = gclid || wbraid || gbraid;
      if (!clickId) continue;

      const rawTime = (sig as { google_conversion_time: string }).google_conversion_time || '';
      const conversionTime = formatGoogleAdsTimeCompact(rawTime, (site as { timezone?: string | null }).timezone);
      const conversionName = (sig as { google_conversion_name: string }).google_conversion_name || 'OpsMantik_Signal';

      const rowValue = (sig as { conversion_value?: number | null }).conversion_value;
      const orderIdDDA = `${clickId}_${conversionName}_${conversionTime}`.slice(0, 128);
      signalItems.push({
        id: 'signal_' + (sig as { id: string }).id,
        orderId: orderIdDDA || 'signal_' + (sig as { id: string }).id,
        gclid: gclid || '',
        wbraid: wbraid || '',
        gbraid: gbraid || '',
        conversionName,
        conversionTime,
        conversionValue: Number(rowValue) || 0,
        conversionCurrency: (site as { currency?: string })?.currency || 'TRY',
      });
    }

    // Pipeline C: Redis Page Views (Ops_PageView)
    const pvItems: GoogleAdsConversionItem[] = [];
    const siteRedisKey = (site as { public_id?: string | null })?.public_id || siteUuid;
    try {
      const pvIds: string[] = [];
      for (let i = 0; i < PV_BATCH_MAX; i++) {
        const id = await redis.lmove(
          `pv:queue:${siteRedisKey}`,
          `pv:processing:${siteRedisKey}`,
          'right',
          'left'
        );
        if (!id || typeof id !== 'string') break;
        pvIds.push(id);
      }
      for (const pvId of pvIds) {
        // 10% deterministic sampling: hash(pvId) % 10 === 0
        const hash = simpleHash(pvId);
        if (hash % 10 !== 0) continue;
        const raw = await redis.get(`pv:data:${pvId}`);
        if (!raw || typeof raw !== 'string') continue;
        let payload: { siteId?: string; gclid?: string; wbraid?: string; gbraid?: string; timestamp?: string };
        try {
          payload = JSON.parse(raw) as typeof payload;
        } catch {
          continue;
        }
        const gclid = (payload.gclid || '').trim();
        const wbraid = (payload.wbraid || '').trim();
        const gbraid = (payload.gbraid || '').trim();
        const clickId = gclid || wbraid || gbraid;
        if (!clickId) continue;
        const rawTime = payload.timestamp || new Date().toISOString();
        const conversionTime = formatGoogleAdsTimeCompact(rawTime, (site as { timezone?: string | null }).timezone);
        const pvOrderIdDDA = `${clickId}_${OPSMANTIK_CONVERSION_NAMES.V1_PAGEVIEW}_${conversionTime}`.slice(0, 128);
        pvItems.push({
          id: pvId,
          orderId: pvOrderIdDDA || pvId,
          gclid: gclid || '',
          wbraid: wbraid || '',
          gbraid: gbraid || '',
          conversionName: OPSMANTIK_CONVERSION_NAMES.V1_PAGEVIEW,
          conversionTime,
          conversionValue: 0,
          conversionCurrency: (site as { currency?: string })?.currency || 'TRY',
        });
      }
    } catch (redisErr) {
      const { logError } = await import('@/lib/logging/logger');
      logError('OCI_EXPORT_PV_REDIS_ERROR', { error: redisErr instanceof Error ? redisErr.message : String(redisErr) });
    }

    if (rawList.length === 0 && signalItems.length === 0 && pvItems.length === 0) {
      return NextResponse.json([]);
    }

    const callIds = rawList.map((r: { call_id: string | null }) => r.call_id).filter(Boolean) as string[];
    const sessionByCall: Record<string, string> = {};
    const sessionCreatedAt: Record<string, string> = {};
    const callCreatedAt: Record<string, string> = {};
    if (callIds.length > 0) {
      const { data: calls } = await adminClient
        .from('calls')
        .select('id, matched_session_id, created_at')
        .eq('site_id', siteUuid)
        .in('id', callIds);
      for (const c of calls ?? []) {
        const sid = (c as { matched_session_id?: string | null }).matched_session_id;
        if (sid) sessionByCall[(c as { id: string }).id] = sid;
        const ca = (c as { created_at?: string | null }).created_at;
        if (ca) callCreatedAt[(c as { id: string }).id] = ca;
      }
      const sessionIds = [...new Set(Object.values(sessionByCall))].filter(Boolean);
      if (sessionIds.length > 0) {
        const { data: sessions } = await adminClient
          .from('sessions')
          .select('id, created_at')
          .in('id', sessionIds);
        for (const s of sessions ?? []) {
          const created = (s as { created_at?: string | null }).created_at;
          if (created) sessionCreatedAt[(s as { id: string }).id] = created;
        }
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
        const { data: claimedCount, error: rpcError } = await adminClient.rpc(
          'claim_offline_conversion_rows_for_script_export',
          { p_ids: idsToMarkProcessing, p_site_id: siteUuid }
        );
        if (rpcError) {
          const { logError } = await import('@/lib/logging/logger');
          logError('OCI_GOOGLE_ADS_EXPORT_CLAIM_FAILED', { code: (rpcError as { code?: string })?.code });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        if (typeof claimedCount !== 'number' || claimedCount !== idsToMarkProcessing.length) {
          const { logWarn } = await import('@/lib/logging/logger');
          logWarn('OCI_GOOGLE_ADS_EXPORT_CLAIM_PARTIAL', {
            requested: idsToMarkProcessing.length,
            claimed: claimedCount,
          });
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
      created_at?: string | null;
      value_cents: number;
      currency?: string | null;
      action?: string | null;
    }) => {
      // Original event time: calls.created_at > queue.created_at (fallback)
      const rawTs = row.call_id ? callCreatedAt[row.call_id] : null;
      const fallbackTs = (row.created_at || row.conversion_time) || '';
      const baseTs = rawTs || fallbackTs;
      const tsMs = new Date(baseTs || 0).getTime();
      const now = Date.now();
      const exportTs =
        tsMs > 0 && tsMs <= now ? baseTs : new Date(now - 60 * 1000).toISOString();
      const conversionTime = formatGoogleAdsTimeCompact(exportTs, (site as { timezone?: string | null }).timezone);

      // V5 Iron Seal: raw value_cents/100. No decay.
      const valueCents = Number(row.value_cents) || 0;
      const conversionValue = ensureNumericValue(valueCents / 100);

      const conversionCurrency = ensureCurrencyCode(row.currency || currency || 'TRY');
      const clickId = (row.gclid || row.wbraid || row.gbraid || '').trim();
      const orderIdDDA = `${clickId}_${OPSMANTIK_CONVERSION_NAMES.V5_SEAL}_${conversionTime}`.slice(0, 128);

      return {
        id: 'seal_' + String(row.id),
        orderId: orderIdDDA || 'seal_' + String(row.id),
        gclid: (row.gclid || '').trim(),
        wbraid: (row.wbraid || '').trim(),
        gbraid: (row.gbraid || '').trim(),
        conversionName: OPSMANTIK_CONVERSION_NAMES.V5_SEAL,
        conversionTime,
        conversionValue,
        conversionCurrency,
      };
    });

    const combined = [...conversions, ...signalItems, ...pvItems].sort(
      (a, b) => (a.conversionTime || '').localeCompare(b.conversionTime || '')
    );

    if (markAsExported) {
      return NextResponse.json(combined);
    }
    return NextResponse.json({
      siteId: siteUuid,
      items: combined,
      counts: { queued: list.length, skipped: skippedIds.length },
      warnings: [],
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}

/** Deterministic hash for 10% V1 sampling. */
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h);
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
