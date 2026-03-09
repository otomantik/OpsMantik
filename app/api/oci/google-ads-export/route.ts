import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { formatGoogleAdsTimeOrNull } from '@/lib/utils/format-google-ads-time';
import { buildOrderId } from '@/lib/oci/build-order-id';
import { computeOfflineConversionExternalId } from '@/lib/oci/external-id';
import { logWarn, logError, logInfo } from '@/lib/logging/logger';
import { minorToMajor } from '@/lib/i18n/currency';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/domain/mizan-mantik';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { verifySessionToken } from '@/lib/oci/session-auth';
import { getEntitlements } from '@/lib/entitlements/getEntitlements';
import { requireCapability, EntitlementError } from '@/lib/entitlements/requireEntitlement';
import { getPrimarySourceBatch } from '@/lib/conversation/primary-source';
import { getPrimarySourceWithDiscovery } from '@/lib/oci/identity-stitcher';
import { redis } from '@/lib/upstash';
import type { SiteValuationRow } from '@/lib/oci/oci-config';
import { hashPhoneForEC } from '@/lib/dic/identity-hash';
import { isCallSendableForSealExport, isCallStatusSendableForOci, isCallStatusSendableForSignal } from '@/lib/oci/call-sendability';
import { validateOciQueueValueCents, validateOciSignalConversionValue } from '@/lib/oci/export-value-guard';
import { pickCanonicalOccurredAt } from '@/lib/oci/occurred-at';
import { getPvDataKey, getPvProcessingKey, getPvProcessingKeysForCleanup, getPvQueueKeysForExport } from '@/lib/oci/pv-redis';
import { createHash } from 'node:crypto';
import * as jose from 'jose';

const PV_BATCH_MAX = 500;
/** P0-1.2: Hard cap to prevent memory exhaustion. Log warning if hit. */
const EXPORT_QUEUE_LIMIT = 1000;
const EXPORT_SIGNALS_LIMIT = 1000;
const V1_PAGEVIEW_VISIBILITY_MINOR = 1;

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
  /** Format: yyyy-mm-dd HH:mm:ss±HH:mm (timezone required). Prefer canonical occurred_at. */
  conversionTime: string;
  /** Numeric value only (e.g. 750.00). No currency symbols. */
  conversionValue: number;
  /** ISO currency code, e.g. TRY. */
  conversionCurrency: string;
  /** Optional: SHA-256 hex (64 char) for Enhanced Conversions. */
  hashed_phone_number?: string | null;
  /** Phase 20: OM-TRACE-UUID for conversion_custom_variable (forensic chain) */
  om_trace_uuid?: string | null;
}

type ExportCursorMark = {
  t: string;
  i: string;
};

type ExportCursorState = {
  q?: ExportCursorMark | null;
  s?: ExportCursorMark | null;
};

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

    let siteIdFromAuth = '';

    if (sessionToken) {
      const parsed = await verifySessionToken(sessionToken);
      if (parsed) {
        siteIdFromAuth = parsed.siteId;
      }
    }

    // Proceed only if we have a valid session token or a per-site API key attempt.
    // Global OCI_API_KEY bypass was removed (tenant isolation violation).
    const hasAuthAttempt = !!siteIdFromAuth || !!apiKey;

    if (!hasAuthAttempt) {
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
    const cursorStr = searchParams.get('cursor');

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
    }

    // Kill switch: OCI_EXPORT_PAUSED — emergency pause without redeploy (Phase 40)
    if (process.env.OCI_EXPORT_PAUSED === 'true' || process.env.OCI_EXPORT_PAUSED === '1') {
      logWarn('OCI_EXPORT_PAUSED', { msg: 'Export paused via OCI_EXPORT_PAUSED env' });
      return NextResponse.json({ error: 'Export paused', code: 'EXPORT_PAUSED' }, { status: 503 });
    }

    // Phase 6.2: Deterministic Cursor Decomposition
    let queueCursorUpdatedAt: string | null = null;
    let queueCursorId: string | null = null;
    let signalCursorUpdatedAt: string | null = null;
    let signalCursorId: string | null = null;
    if (cursorStr) {
      try {
        const decoded = JSON.parse(Buffer.from(cursorStr, 'base64').toString('utf8'));
        const queueCursor = readExportCursorMark(decoded?.q ?? decoded);
        const signalCursor = readExportCursorMark(decoded?.s ?? decoded);
        queueCursorUpdatedAt = queueCursor?.t ?? null;
        queueCursorId = queueCursor?.i ?? null;
        signalCursorUpdatedAt = signalCursor?.t ?? null;
        signalCursorId = signalCursor?.i ?? null;
      } catch (_e: unknown) {
        void _e;
        logWarn('OCI_EXPORT_INVALID_CURSOR', { cursor: cursorStr });
      }
    }

    // Phase 8.3: Ghost Cursor (Replication Lag Fallback)
    // If a cursor is provided but we suspect we are in a stale replica (e.g. cursor is in the "future" 
    // relative to our current MAX updated_at), we fallback to a safe consensus.
    let isGhostCursor = false;
    if (queueCursorUpdatedAt) {
      const { data: latestRow } = await adminClient
        .from('offline_conversion_queue')
        .select('updated_at')
        .eq('site_id', siteId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const ourMax = (latestRow as { updated_at?: string })?.updated_at;
      if (ourMax && queueCursorUpdatedAt > ourMax) {
        logWarn('OCI_EXPORT_GHOST_CURSOR_DETECTED', { cursor: queueCursorUpdatedAt, ourMax });
        isGhostCursor = true;
        // Fallback: Resume from the last SENT/COMPLETED record instead of crashing.
        const { data: consensus } = await adminClient
          .from('offline_conversion_queue')
          .select('updated_at, id')
          .eq('site_id', siteId)
          .eq('status', 'COMPLETED')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (consensus) {
          queueCursorUpdatedAt = (consensus as { updated_at: string }).updated_at;
          queueCursorId = (consensus as { id: string }).id;
        }
      }
    }

    // Resolve site by id (UUID) or public_id (e.g. 32-char hex)
    let site: (SiteValuationRow & { id: string; public_id?: string | null; currency?: string | null; timezone?: string | null; oci_sync_method?: string | null; oci_api_key?: string | null }) | null = null;
    const byId = await adminClient.from('sites').select('id, public_id, currency, timezone, oci_sync_method, default_aov, intent_weights, oci_api_key').eq('id', siteId).maybeSingle();
    if (byId.data) {
      site = byId.data as SiteValuationRow & { id: string; public_id?: string | null; currency?: string | null; timezone?: string | null; oci_sync_method?: string | null; oci_api_key?: string | null };
    }
    if (!site) {
      const byPublicId = await adminClient.from('sites').select('id, public_id, currency, timezone, oci_sync_method, default_aov, intent_weights, oci_api_key').eq('public_id', siteId).maybeSingle();
      if (byPublicId.data) {
        site = byPublicId.data as SiteValuationRow & { id: string; public_id?: string | null; currency?: string | null; timezone?: string | null; oci_sync_method?: string | null; oci_api_key?: string | null };
      }
    }
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Final Authentication Verification — per-site only, no global bypass.
    if (apiKey) {
      const siteKey = (site as { oci_api_key?: string | null }).oci_api_key ?? '';
      if (!siteKey || !timingSafeCompare(siteKey, apiKey)) {
        return NextResponse.json({ error: 'Unauthorized: Invalid API key' }, { status: 401 });
      }
    } else if (siteIdFromAuth) {
      if (siteIdFromAuth !== site.id && siteIdFromAuth !== site.public_id) {
        return NextResponse.json({ error: 'Forbidden: Token site mismatch' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // Phase 1: Projection is SSOT. USE_FUNNEL_PROJECTION=false allows legacy fallback during cutover.
    const useFunnelProjection = process.env.USE_FUNNEL_PROJECTION !== 'false';
    if (useFunnelProjection) {
      try {
        const { data: projRows } = await adminClient
          .from('call_funnel_projection')
          .select('call_id, site_id, v5_at, value_cents, currency')
          .eq('site_id', siteUuid)
          .eq('export_status', 'READY')
          .eq('funnel_completeness', 'complete')
          .not('v5_at', 'is', null)
          .limit(EXPORT_QUEUE_LIMIT);

        const projList = Array.isArray(projRows) ? projRows : [];
        const items: GoogleAdsConversionItem[] = [];
        const callIds = projList.map((r: { call_id: string }) => r.call_id);

        if (callIds.length > 0) {
          const { data: callsForStitch } = await adminClient
            .from('calls')
            .select('id, caller_phone_e164, matched_fingerprint, confirmed_at, created_at')
            .eq('site_id', siteUuid)
            .in('id', callIds);
          const directSource = await getPrimarySourceBatch(siteUuid, callIds);
          const callCtxByCallId = new Map<string, { caller_phone_e164?: string; callTime: string }>();
          for (const c of callsForStitch ?? []) {
            const id = (c as { id: string }).id;
            const confirmed = (c as { confirmed_at?: string }).confirmed_at;
            const created = (c as { created_at?: string }).created_at;
            callCtxByCallId.set(id, {
              caller_phone_e164: (c as { caller_phone_e164?: string }).caller_phone_e164 ?? undefined,
              callTime: confirmed ?? created ?? new Date().toISOString(),
            });
          }

          for (const row of projList) {
            const callId = (row as { call_id: string }).call_id;
            const v5At = (row as { v5_at?: string | null }).v5_at;
            const valueCents = (row as { value_cents?: number | null }).value_cents;
            const rowCurrency = (row as { currency?: string | null }).currency;
            const ctx = callCtxByCallId.get(callId);
            const direct = directSource.get(callId) ?? null;
            const discovered = await getPrimarySourceWithDiscovery(siteUuid, direct, {
              callId,
              callTime: ctx?.callTime ?? v5At ?? new Date().toISOString(),
              callerPhoneE164: ctx?.caller_phone_e164 ?? null,
              fingerprint: undefined,
            });
            const gclid = (discovered?.source?.gclid ?? '').trim();
            const wbraid = (discovered?.source?.wbraid ?? '').trim();
            const gbraid = (discovered?.source?.gbraid ?? '').trim();
            const clickId = gclid || wbraid || gbraid;
            if (!clickId) continue;

            const conversionTime = formatGoogleAdsTimeOrNull(v5At, (site as { timezone?: string | null }).timezone);
            if (!conversionTime) {
              logWarn('EXPORT_SKIP_MISSING_TIMESTAMP', { call_id: callId, v5_at: v5At ?? null });
              continue;
            }

            const siteCurrency = (site as { currency?: string })?.currency;
            const rawCurrency = rowCurrency ?? siteCurrency;
            if (!rawCurrency || typeof rawCurrency !== 'string' || rawCurrency.trim().length < 3) {
              logWarn('EXPORT_SKIP_MISSING_CURRENCY', { call_id: callId });
              continue;
            }
            const currency = rawCurrency.trim().toUpperCase().slice(0, 3);

            if (valueCents == null || !Number.isFinite(valueCents) || valueCents <= 0) {
              logWarn('EXPORT_SKIP_MISSING_VALUE_CENTS', { call_id: callId, value_cents: valueCents ?? null });
              continue;
            }
            const valueUnits = minorToMajor(valueCents, currency);

            const convName = OPSMANTIK_CONVERSION_NAMES.V5_SEAL;
            const orderId = buildOrderId(convName, clickId, conversionTime, `proj_${callId}`, callId, Math.round(valueUnits * 100));
            items.push({
              id: `proj_${callId}`,
              orderId: orderId || `proj_${callId}`,
              gclid,
              wbraid,
              gbraid,
              conversionName: convName,
              conversionTime,
              conversionValue: valueUnits,
              conversionCurrency: currency,
            });
          }

          if (markAsExported && callIds.length > 0) {
            await adminClient
              .from('call_funnel_projection')
              .update({ export_status: 'EXPORTED', updated_at: new Date().toISOString() })
              .eq('site_id', siteUuid)
              .in('call_id', callIds)
              .eq('export_status', 'READY');
          }
        }

        return NextResponse.json({
          items,
          next_cursor: null,
          _source: 'funnel_projection',
        });
      } catch (projErr) {
        logError('USE_FUNNEL_PROJECTION_EXPORT_FAILED', {
          error: projErr instanceof Error ? projErr.message : String(projErr),
          site_id: siteUuid,
        });
        return NextResponse.json({ error: 'Funnel projection export failed', code: 'PROJECTION_EXPORT_ERROR' }, { status: 500 });
      }
    }

    // Phase 6.2: Deterministic Cursor-Based Query (offline_conversion_queue)
    // Formula: (updated_at, id) > (last_t, last_i)
    let query = adminClient
      .from('offline_conversion_queue')
      .select('id, sale_id, call_id, gclid, wbraid, gbraid, conversion_time, occurred_at, created_at, updated_at, value_cents, currency, action, external_id, session_id, provider_key')
      .eq('site_id', siteUuid)
      .in('status', ['QUEUED', 'RETRY'])
      .eq('provider_key', providerFilter);

    if (queueCursorUpdatedAt && queueCursorId) {
      query = query.or(`updated_at.gt.${queueCursorUpdatedAt},and(updated_at.eq.${queueCursorUpdatedAt},id.gt.${queueCursorId})`);
    }

    const { data: rows, error: fetchError } = await query
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(EXPORT_QUEUE_LIMIT);

    if (fetchError) {
      const { logError } = await import('@/lib/logging/logger');
      logError('OCI_GOOGLE_ADS_EXPORT_QUEUE_FAILED', { code: (fetchError as { code?: string })?.code });
      return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
    }

    const rawList = Array.isArray(rows) ? rows : [];
    if (rawList.length === EXPORT_QUEUE_LIMIT) {
      logWarn('OCI_EXPORT_BATCH_HIT_LIMIT', { limit: EXPORT_QUEUE_LIMIT, pipeline: 'offline_conversion_queue' });
    }

    // Phase 6.2: Deterministic Cursor-Based Query (marketing_signals)
    // NOTE: marketing_signals has no updated_at column — use created_at for ordering and cursors.
    let sigQuery = adminClient
      .from('marketing_signals')
      .select('id, call_id, signal_type, google_conversion_name, google_conversion_time, occurred_at, conversion_value, gclid, wbraid, gbraid, trace_id, created_at, adjustment_sequence, expected_value_cents, previous_hash, current_hash')
      .eq('site_id', siteUuid)
      .eq('dispatch_status', 'PENDING');

    if (signalCursorUpdatedAt && signalCursorId) {
      sigQuery = sigQuery.or(`created_at.gt.${signalCursorUpdatedAt},and(created_at.eq.${signalCursorUpdatedAt},id.gt.${signalCursorId})`);
    }

    const { data: signalRows, error: signalFetchError } = await sigQuery
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(EXPORT_SIGNALS_LIMIT);

    if (signalFetchError) {
      logError('OCI_EXPORT_SIGNAL_QUERY_FAILED', {
        code: (signalFetchError as { code?: string })?.code,
        message: (signalFetchError as { message?: string })?.message,
        site_id: siteUuid,
      });
      return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
    }
    const signalList = Array.isArray(signalRows) ? signalRows : [];
    if (signalList.length === EXPORT_SIGNALS_LIMIT) {
      logWarn('OCI_EXPORT_BATCH_HIT_LIMIT', { limit: EXPORT_SIGNALS_LIMIT, pipeline: 'marketing_signals' });
    }

    // Phase 8.1: Merkle Tree Ledger Verification
    // Verify cryptographic integrity of the signal chain in memory.
    // Signals with current_hash=null are pre-Merkle legacy records — they are trusted as-is
    // (the hash feature was introduced after these signals were created). Only signals with a
    // non-null hash are verified to prevent tampering.
    let salt = process.env.VOID_LEDGER_SALT?.trim();
    if (!salt) {
      logWarn('VOID_LEDGER_SALT_MISSING', { msg: 'Using insecure fallback; set VOID_LEDGER_SALT in production.' });
      salt = 'void_consensus_salt_insecure';
    }
    for (const sig of signalList) {
      const s = sig as {
        id: string;
        call_id: string | null;
        adjustment_sequence: number;
        expected_value_cents: number;
        previous_hash: string | null;
        current_hash: string | null;
      };

      if (s.current_hash === null) continue; // Legacy signal, pre-Merkle — skip hash check

      // Only enforce Merkle when a custom production salt is explicitly set.
      // If using the insecure default, the hash may have been computed with a different
      // salt version and should not block exports — log a warning instead.
      const hasProductionSalt = !!process.env.VOID_LEDGER_SALT;
      if (hasProductionSalt) {
        const payload = `${s.call_id ?? 'null'}:${s.adjustment_sequence}:${s.expected_value_cents}:${s.previous_hash ?? 'null'}:${salt}`;
        const expectedHash = createHash('sha256').update(payload).digest('hex');

        if (s.current_hash !== expectedHash) {
          // Log the mismatch but do NOT halt the export — stale hashes from salt rotation
          // should not block revenue signals from being sent to Google Ads.
          logWarn('LEDGER_HASH_MISMATCH', {
            signal_id: s.id,
            expected: expectedHash,
            actual: s.current_hash,
            msg: 'Merkle hash mismatch — possible salt rotation or legacy hash. Export continues.',
          });
        }
      }
    }

    // P0-1.3: Use row gclid/wbraid/gbraid if set (Self-Healing recovered), else primary source
    const signalCallIds = signalList
      .map((s) => (s as { call_id?: string | null }).call_id)
      .filter((id): id is string => Boolean(id));
    const sourceMap = await getPrimarySourceBatch(siteUuid, signalCallIds);

    // Fetch call context for Identity Stitcher (caller_phone, fingerprint)
    const { data: callsForStitch } = signalCallIds.length > 0
      ? await adminClient.from('calls').select('id, caller_phone_e164, matched_fingerprint, confirmed_at, created_at, status').eq('site_id', siteUuid).in('id', signalCallIds)
      : { data: [] };
    const callCtxByCallId = new Map<string, { caller_phone_e164?: string; matched_fingerprint?: string; callTime: string; status?: string | null }>();
    for (const c of callsForStitch ?? []) {
      const id = (c as { id: string }).id;
      const confirmed = (c as { confirmed_at?: string }).confirmed_at;
      const created = (c as { created_at?: string }).created_at;
      callCtxByCallId.set(id, {
        caller_phone_e164: (c as { caller_phone_e164?: string }).caller_phone_e164 ?? undefined,
        matched_fingerprint: (c as { matched_fingerprint?: string }).matched_fingerprint ?? undefined,
        callTime: confirmed ?? created ?? new Date().toISOString(),
        status: (c as { status?: string | null }).status ?? null,
      });
    }

    const blockedSignalIds: string[] = [];
    const blockedSignalTimeIds: string[] = [];
    const blockedSignalValueIds: string[] = [];
    const signalItems: GoogleAdsConversionItem[] = [];
    for (const sig of signalList) {
      const callId = (sig as { call_id?: string | null }).call_id;
      if (!callId) continue;
      const ctx = callCtxByCallId.get(callId);
      const sigType = (sig as { signal_type?: string }).signal_type ?? '';
      if (!isCallStatusSendableForSignal(ctx?.status ?? null, sigType)) {
        blockedSignalIds.push((sig as { id: string }).id);
        continue;
      }

      // Prefer recovered click_id from row (Self-Healing)
      let gclid = (sig as { gclid?: string | null }).gclid?.trim() ?? '';
      let wbraid = (sig as { wbraid?: string | null }).wbraid?.trim() ?? '';
      let gbraid = (sig as { gbraid?: string | null }).gbraid?.trim() ?? '';
      let clickId = gclid || wbraid || gbraid;

      if (!clickId) {
        const directSource = sourceMap.get(callId) ?? null;
        const discovered = await getPrimarySourceWithDiscovery(siteUuid, directSource, {
          callId,
          callTime: ctx?.callTime ?? (sig as { occurred_at?: string | null; google_conversion_time?: string }).occurred_at ?? (sig as { google_conversion_time?: string }).google_conversion_time ?? new Date().toISOString(),
          callerPhoneE164: ctx?.caller_phone_e164 ?? null,
          fingerprint: ctx?.matched_fingerprint ?? null,
        });
        if (discovered?.source) {
          gclid = (discovered.source.gclid ?? '').trim();
          wbraid = (discovered.source.wbraid ?? '').trim();
          gbraid = (discovered.source.gbraid ?? '').trim();
          clickId = gclid || wbraid || gbraid;
        }
      }

      if (!clickId) {
        // Leave PENDING for Self-Healing; do NOT mark SKIPPED_NO_CLICK_ID
        logWarn('OCI_EXPORT_SIGNAL_SKIP_NO_CLICK_ID', { signal_id: (sig as { id: string }).id, call_id: callId });
        continue;
      }

      const rawTime = pickCanonicalOccurredAt([
        (sig as { occurred_at?: string | null }).occurred_at,
        (sig as { google_conversion_time?: string | null }).google_conversion_time,
        (sig as { created_at?: string | null }).created_at,
      ]);
      if (!rawTime) {
        logError('OCI_EXPORT_SIGNAL_OCCURRED_AT_MISSING', {
          signal_id: (sig as { id: string }).id,
          call_id: callId,
        });
        continue;
      }
      const conversionTime = formatGoogleAdsTimeOrNull(rawTime, (site as { timezone?: string | null }).timezone);
      if (!conversionTime) {
        blockedSignalTimeIds.push((sig as { id: string }).id);
        logError('OCI_EXPORT_SIGNAL_TIME_INVALID', {
          signal_id: (sig as { id: string }).id,
          call_id: callId,
          raw_time: rawTime,
        });
        continue;
      }
      const conversionName = (sig as { google_conversion_name: string }).google_conversion_name || 'OpsMantik_Signal';

      const rowValue = (sig as { conversion_value?: number | null }).conversion_value;
      const valueGuard = validateOciSignalConversionValue(rowValue);
      if (!valueGuard.ok) {
        blockedSignalValueIds.push((sig as { id: string }).id);
        logWarn('OCI_EXPORT_SIGNAL_SKIP_VALUE', {
          signal_id: (sig as { id: string }).id,
          reason:
            valueGuard.reason === 'NULL_VALUE'
              ? 'NULL_CONVERSION_VALUE'
              : valueGuard.reason === 'NON_FINITE_VALUE'
                ? 'NON_FINITE_CONVERSION_VALUE'
                : 'NON_POSITIVE_CONVERSION_VALUE',
          raw: rowValue ?? null,
        });
        continue;
      }
      const signalRowId = (sig as { id: string }).id;
      const numVal = valueGuard.normalized;
      const signalValueMicros = Math.round(numVal * 100);
      const orderIdDDA = buildOrderId(
        conversionName,
        clickId || null,
        conversionTime,
        `signal_${signalRowId}`,
        signalRowId,
        signalValueMicros
      );
      const traceId = (sig as { trace_id?: string | null }).trace_id ?? null;
      signalItems.push({
        id: `signal_${signalRowId}`,
        orderId: orderIdDDA || `signal_${signalRowId}`,
        gclid: gclid || '',
        wbraid: wbraid || '',
        gbraid: gbraid || '',
        conversionName,
        conversionTime,
        conversionValue: numVal,
        conversionCurrency: (site as { currency?: string })?.currency || 'TRY',
        ...(traceId && { om_trace_uuid: traceId }),
      });
    }

    // PENDING signals without click_id are left for Self-Healing Pulse to retry (no SKIPPED update here)

    // Pipeline C: Redis Page Views (Ops_PageView)
    // Sampling is script-owned. Backend must return every eligible V1 row so skippedIds stay auditable.
    const pvItems: GoogleAdsConversionItem[] = [];
    if (markAsExported) try {
      const pvIds: string[] = [];
      const invalidPvIds: string[] = [];
      const pvQueueKeys = getPvQueueKeysForExport(siteUuid, (site as { public_id?: string | null }).public_id);
      const pvProcessingKey = getPvProcessingKey(siteUuid);
      for (let i = 0; i < PV_BATCH_MAX; i++) {
        let moved = false;
        for (const queueKey of pvQueueKeys) {
          const id = await redis.lmove(queueKey, pvProcessingKey, 'right', 'left');
          if (!id || typeof id !== 'string') continue;
          pvIds.push(id);
          moved = true;
          break;
        }
        if (!moved) break;
      }
      for (const pvId of pvIds) {
        const raw = await redis.get(getPvDataKey(pvId));
        if (!raw || typeof raw !== 'string') continue;
        let payload: {
          siteId?: string;
          gclid?: string;
          wbraid?: string;
          gbraid?: string;
          timestamp?: string;
          conversionValueMinor?: number;
        };
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
        const rawTime = payload.timestamp || null;
        const conversionTime = formatGoogleAdsTimeOrNull(rawTime, (site as { timezone?: string | null }).timezone);
        if (!conversionTime) {
          invalidPvIds.push(pvId);
          logError('OCI_EXPORT_PV_TIME_INVALID', { pv_id: pvId, raw_time: rawTime });
          continue;
        }
        const currency = (site as { currency?: string })?.currency || 'TRY';
        const conversionValueMinor =
          typeof payload.conversionValueMinor === 'number' && Number.isFinite(payload.conversionValueMinor) && payload.conversionValueMinor > 0
            ? Math.round(payload.conversionValueMinor)
            : V1_PAGEVIEW_VISIBILITY_MINOR;
        const pvOrderIdDDA = buildOrderId(
          OPSMANTIK_CONVERSION_NAMES.V1_PAGEVIEW,
          clickId || null,
          conversionTime,
          pvId,
          pvId,
          0
        );
        pvItems.push({
          id: pvId,
          orderId: pvOrderIdDDA || pvId,
          gclid: gclid || '',
          wbraid: wbraid || '',
          gbraid: gbraid || '',
          conversionName: OPSMANTIK_CONVERSION_NAMES.V1_PAGEVIEW,
          conversionTime,
          conversionValue: minorToMajor(conversionValueMinor, currency),
          conversionCurrency: currency,
        });
      }
      if (invalidPvIds.length > 0) {
        const processingKeys = getPvProcessingKeysForCleanup(siteUuid, (site as { public_id?: string | null }).public_id);
        await Promise.all(
          invalidPvIds.map(async (pvId) => {
            await Promise.all([
              redis.del(getPvDataKey(pvId)),
              ...processingKeys.map((processingKey) => redis.lrem(processingKey, 0, pvId)),
            ]);
          })
        );
      }
    } catch (redisErr) {
      const { logError } = await import('@/lib/logging/logger');
      logError('OCI_EXPORT_PV_REDIS_ERROR', { error: redisErr instanceof Error ? redisErr.message : String(redisErr) });
    }

    if (rawList.length === 0 && signalItems.length === 0 && pvItems.length === 0) {
      return NextResponse.json({ items: [], next_cursor: null });
    }

    const callIds = rawList.map((r: { call_id: string | null }) => r.call_id).filter(Boolean) as string[];
    const sessionByCall: Record<string, string> = {};
    const callConfirmedAt: Record<string, string> = {};
    const callPhoneByCallId: Record<string, string> = {};
    const callStatusByCallId: Record<string, string | null> = {};
    const callOciStatusByCallId: Record<string, string | null> = {};
    if (callIds.length > 0) {
      const { data: calls } = await adminClient
        .from('calls')
        .select('id, matched_session_id, confirmed_at, caller_phone_e164, status, oci_status')
        .eq('site_id', siteUuid)
        .in('id', callIds);
      for (const c of calls ?? []) {
        const id = (c as { id: string }).id;
        const sid = (c as { matched_session_id?: string | null }).matched_session_id;
        if (sid) sessionByCall[id] = sid;
        const confirmed = (c as { confirmed_at?: string | null }).confirmed_at;
        if (confirmed) callConfirmedAt[id] = confirmed;
        const phone = (c as { caller_phone_e164?: string | null }).caller_phone_e164;
        if (phone && String(phone).trim()) callPhoneByCallId[id] = String(phone).trim();
        callStatusByCallId[id] = (c as { status?: string | null }).status ?? null;
        callOciStatusByCallId[id] = (c as { oci_status?: string | null }).oci_status ?? null;
      }
    }

    const blockedQueueIds = rawList
      .filter((row) => {
        const callId = (row as { call_id?: string | null }).call_id;
        if (!callId) return false;
        return !isCallSendableForSealExport(callStatusByCallId[callId], callOciStatusByCallId[callId]);
      })
      .map((row) => (row as { id: string }).id);
    const blockedQueueIdSet = new Set(blockedQueueIds);
    const sendableRawList = rawList.filter((row) => !blockedQueueIdSet.has((row as { id: string }).id));

    // Axiom 2: Defensive sorting — isolate NaN/invalid dates, put them last (no temporal poisoning)
    const { safeConversionTimeMs } = await import('@/lib/utils/temporal-sanity');
    const byConversionTime = [...sendableRawList].sort((a, b) => {
      const ta = safeConversionTimeMs((a as { conversion_time: string }).conversion_time);
      const tb = safeConversionTimeMs((b as { conversion_time: string }).conversion_time);
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return ta - tb;
    });
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
    const signalIdsToMarkProcessing = signalItems.map((s: { id: string }) => s.id.replace('signal_', ''));

    if (markAsExported && (idsToMarkProcessing.length > 0 || skippedIds.length > 0 || signalIdsToMarkProcessing.length > 0 || blockedQueueIds.length > 0 || blockedSignalIds.length > 0 || blockedSignalTimeIds.length > 0 || blockedSignalValueIds.length > 0)) {
      const now = new Date().toISOString();
      if (blockedQueueIds.length > 0) {
        const { data: blockedClaimedCount, error: blockedClaimError } = await adminClient.rpc(
          'append_script_claim_transition_batch',
          { p_queue_ids: blockedQueueIds, p_claimed_at: now }
        );
        if (blockedClaimError || typeof blockedClaimedCount !== 'number' || blockedClaimedCount !== blockedQueueIds.length) {
          logError('OCI_GOOGLE_ADS_EXPORT_BLOCKED_CLAIM_FAILED', {
            code: (blockedClaimError as { code?: string })?.code,
            requested: blockedQueueIds.length,
            claimed: blockedClaimedCount,
          });
          return NextResponse.json({ error: 'Blocked queue claim mismatch', code: 'QUEUE_CLAIM_MISMATCH' }, { status: 409 });
        }
        const { data: blockedUpdatedCount, error: blockedUpdateError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: blockedQueueIds,
          p_new_status: 'FAILED',
          p_created_at: now,
          p_error_payload: {
            last_error: 'CALL_NOT_SENDABLE_FOR_OCI',
            provider_error_code: 'CALL_NOT_SENDABLE',
            provider_error_category: 'PERMANENT',
            clear_fields: ['next_retry_at', 'uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
          },
        });
        if (blockedUpdateError || typeof blockedUpdatedCount !== 'number' || blockedUpdatedCount !== blockedQueueIds.length) {
          logError('OCI_GOOGLE_ADS_EXPORT_BLOCKED_TERMINALIZE_FAILED', {
            code: (blockedUpdateError as { code?: string })?.code,
            requested: blockedQueueIds.length,
            updated: blockedUpdatedCount,
          });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
      }
      if (idsToMarkProcessing.length > 0) {
        const { data: claimedCount, error: rpcError } = await adminClient.rpc(
          'append_script_claim_transition_batch',
          { p_queue_ids: idsToMarkProcessing, p_claimed_at: now }
        );
        if (rpcError) {
          const { logError } = await import('@/lib/logging/logger');
          logError('OCI_GOOGLE_ADS_EXPORT_CLAIM_FAILED', { code: (rpcError as { code?: string })?.code });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        if (typeof claimedCount !== 'number' || claimedCount !== idsToMarkProcessing.length) {
          const { logError } = await import('@/lib/logging/logger');
          logError('OCI_GOOGLE_ADS_EXPORT_CLAIM_PARTIAL', {
            requested: idsToMarkProcessing.length,
            claimed: claimedCount,
          });
          return NextResponse.json({ error: 'Queue claim mismatch', code: 'QUEUE_CLAIM_MISMATCH' }, { status: 409 });
        }
      }
      if (skippedIds.length > 0) {
        const { data: skippedClaimedCount, error: skippedRpcError } = await adminClient.rpc(
          'append_script_claim_transition_batch',
          { p_queue_ids: skippedIds, p_claimed_at: now }
        );
        if (skippedRpcError) {
          logError('OCI_GOOGLE_ADS_EXPORT_SKIP_CLAIM_FAILED', { code: (skippedRpcError as { code?: string })?.code });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        if (typeof skippedClaimedCount !== 'number' || skippedClaimedCount !== skippedIds.length) {
          logError('OCI_GOOGLE_ADS_EXPORT_SKIP_CLAIM_PARTIAL', {
            requested: skippedIds.length,
            claimed: skippedClaimedCount,
          });
          return NextResponse.json({ error: 'Skipped queue claim mismatch', code: 'QUEUE_CLAIM_MISMATCH' }, { status: 409 });
        }

        const { data: skippedRows } = await adminClient
          .from('offline_conversion_queue')
          .select('id')
          .in('id', skippedIds)
          .eq('site_id', siteUuid)
          .eq('status', 'PROCESSING');
        const skippedRowsList = Array.isArray(skippedRows) ? skippedRows as Array<{ id: string }> : [];
        if (skippedRowsList.length !== skippedIds.length) {
          logError('OCI_GOOGLE_ADS_EXPORT_SKIP_PROCESSING_MISMATCH', { requested: skippedIds.length, processing: skippedRowsList.length });
          return NextResponse.json({ error: 'Skipped queue state mismatch', code: 'QUEUE_STATE_MISMATCH' }, { status: 409 });
        }
        const { data: skippedUpdatedCount, error: skippedUpdateError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: skippedRowsList.map((row) => row.id),
          p_new_status: 'COMPLETED',
          p_created_at: now,
          p_error_payload: {
            uploaded_at: now,
            last_error: 'SESSION_DEDUPLICATED_AT_EXPORT',
            provider_error_code: 'DETERMINISTIC_SKIP',
            provider_error_category: 'DETERMINISTIC_SKIP',
            clear_fields: ['next_retry_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
          },
        });
        if (skippedUpdateError || typeof skippedUpdatedCount !== 'number' || skippedUpdatedCount !== skippedRowsList.length) {
          logError('OCI_GOOGLE_ADS_EXPORT_SKIP_TERMINALIZE_FAILED', { code: (skippedUpdateError as { code?: string })?.code, requested: skippedRowsList.length, updated: skippedUpdatedCount });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
      }

      // Phase 6.1: Mark signals as PROCESSING
      if (signalIdsToMarkProcessing.length > 0) {
        const { data, error: sigStatusError } = await adminClient
          .from('marketing_signals')
          .update({ dispatch_status: 'PROCESSING' })
          .in('id', signalIdsToMarkProcessing)
          .eq('site_id', siteUuid)
          .eq('dispatch_status', 'PENDING')
          .select('id');

        if (sigStatusError) {
          logError('OCI_EXPORT_MARK_SIGNALS_PROCESSING_FAILED', { error: sigStatusError.message });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        const updatedSignals = Array.isArray(data) ? data.length : 0;
        if (updatedSignals !== signalIdsToMarkProcessing.length) {
          logError('OCI_EXPORT_MARK_SIGNALS_PROCESSING_MISMATCH', {
            requested: signalIdsToMarkProcessing.length,
            updated: updatedSignals,
          });
          return NextResponse.json({ error: 'Signal claim mismatch', code: 'SIGNAL_CLAIM_MISMATCH' }, { status: 409 });
        }
      }
      if (blockedSignalIds.length > 0) {
        const { data, error: blockedSignalsError } = await adminClient
          .from('marketing_signals')
          .update({ dispatch_status: 'JUNK_ABORTED' })
          .in('id', blockedSignalIds)
          .eq('site_id', siteUuid)
          .eq('dispatch_status', 'PENDING')
          .select('id');
        if (blockedSignalsError) {
          logError('OCI_EXPORT_BLOCKED_SIGNALS_ABORT_FAILED', { error: blockedSignalsError.message });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        const updatedBlockedSignals = Array.isArray(data) ? data.length : 0;
        if (updatedBlockedSignals !== blockedSignalIds.length) {
          logError('OCI_EXPORT_BLOCKED_SIGNALS_ABORT_MISMATCH', { requested: blockedSignalIds.length, updated: updatedBlockedSignals });
          return NextResponse.json({ error: 'Signal state mismatch', code: 'SIGNAL_STATE_MISMATCH' }, { status: 409 });
        }
      }
      if (blockedSignalTimeIds.length > 0) {
        const { data, error: blockedSignalTimeError } = await adminClient
          .from('marketing_signals')
          .update({ dispatch_status: 'FAILED' })
          .in('id', blockedSignalTimeIds)
          .eq('site_id', siteUuid)
          .eq('dispatch_status', 'PENDING')
          .select('id');
        if (blockedSignalTimeError) {
          logError('OCI_EXPORT_SIGNAL_TIME_ABORT_FAILED', { error: blockedSignalTimeError.message });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        const updatedBlockedSignalTimes = Array.isArray(data) ? data.length : 0;
        if (updatedBlockedSignalTimes !== blockedSignalTimeIds.length) {
          logError('OCI_EXPORT_SIGNAL_TIME_ABORT_MISMATCH', {
            requested: blockedSignalTimeIds.length,
            updated: updatedBlockedSignalTimes,
          });
          return NextResponse.json({ error: 'Signal state mismatch', code: 'SIGNAL_STATE_MISMATCH' }, { status: 409 });
        }
      }
      if (blockedSignalValueIds.length > 0) {
        const { data, error: blockedSignalValueError } = await adminClient
          .from('marketing_signals')
          .update({ dispatch_status: 'FAILED' })
          .in('id', blockedSignalValueIds)
          .eq('site_id', siteUuid)
          .eq('dispatch_status', 'PENDING')
          .select('id');
        if (blockedSignalValueError) {
          logError('OCI_EXPORT_SIGNAL_VALUE_ZERO_ABORT_FAILED', { error: blockedSignalValueError.message });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        const updatedBlockedSignalValues = Array.isArray(data) ? data.length : 0;
        if (updatedBlockedSignalValues !== blockedSignalValueIds.length) {
          logError('OCI_EXPORT_SIGNAL_VALUE_ZERO_ABORT_MISMATCH', {
            requested: blockedSignalValueIds.length,
            updated: updatedBlockedSignalValues,
          });
          return NextResponse.json({ error: 'Signal state mismatch', code: 'SIGNAL_STATE_MISMATCH' }, { status: 409 });
        }
      }
    }

    const currency = (site as { currency?: string })?.currency || 'TRY';

    const siteTimezone = (site as { timezone?: string | null }).timezone ?? 'Europe/Istanbul';

    type QueueRow = {
      id: string;
      sale_id?: string | null;
      call_id?: string | null;
      session_id?: string | null;
      gclid?: string | null;
      wbraid?: string | null;
      gbraid?: string | null;
      conversion_time: string;
      occurred_at?: string | null;
      created_at?: string | null;
      value_cents: number;
      currency?: string | null;
      action?: string | null;
      provider_key?: string | null;
      external_id?: string | null;
    };

    const conversions: GoogleAdsConversionItem[] = [];
    const blockedQueueTimeIds: string[] = [];
    const blockedValueZeroIds: string[] = [];
    for (const row of list as QueueRow[]) {
      const fallbackSealTs = row.call_id ? (callConfirmedAt[row.call_id] ?? null) : null;
      const baseTs = pickCanonicalOccurredAt([
        row.occurred_at,
        row.conversion_time,
        fallbackSealTs,
        row.created_at,
      ]);

      // Null-safe format — skip row if timestamp is missing or invalid (no silent fallback to now).
      const conversionTime = formatGoogleAdsTimeOrNull(baseTs, siteTimezone);
      if (!conversionTime) {
        blockedQueueTimeIds.push(row.id);
        logError('OCI_EXPORT_CONVERSION_TIME_MISSING', {
          queue_id: row.id,
          call_id: row.call_id ?? null,
          occurred_at: row.occurred_at ?? null,
          fallbackSealTs,
          queueTs: row.conversion_time ?? null,
        });
        continue;
      }

      const rawValueCents = (row as { value_cents?: unknown }).value_cents;
      const valueGuard = validateOciQueueValueCents(rawValueCents);
      if (!valueGuard.ok) {
        blockedValueZeroIds.push(row.id);
        logWarn('OCI_EXPORT_SKIP_VALUE_ZERO', {
          queue_id: row.id,
          call_id: row.call_id ?? null,
          reason: valueGuard.reason,
          raw_value_cents: rawValueCents ?? null,
        });
        continue;
      }
      const valueCents = valueGuard.normalized;
      const rowCurrency = row.currency || currency || 'TRY';
      const conversionValue = ensureNumericValue(minorToMajor(valueCents, rowCurrency));
      const conversionCurrency = ensureCurrencyCode(row.currency || currency || 'TRY');
      const clickId = (row.gclid || row.wbraid || row.gbraid || '').trim();
      const fallbackOrderId = 'seal_' + String(row.id);
      const externalId = row.external_id || computeOfflineConversionExternalId({
        providerKey: row.provider_key,
        action: row.action,
        saleId: row.sale_id,
        callId: row.call_id,
        sessionId: row.session_id,
      });
      const orderIdDDA = buildOrderId(
        OPSMANTIK_CONVERSION_NAMES.V5_SEAL,
        clickId || null,
        conversionTime,
        fallbackOrderId,
        row.id,
        valueCents
      );

      let hashedPhone: string | null = null;
      if (row.call_id && callPhoneByCallId[row.call_id]) {
        try {
          hashedPhone = hashPhoneForEC(callPhoneByCallId[row.call_id]);
        } catch {
          // Non-critical; export continues without hashed_phone
        }
      }

      conversions.push({
        id: fallbackOrderId,
        orderId: externalId || orderIdDDA || fallbackOrderId,
        gclid: (row.gclid || '').trim(),
        wbraid: (row.wbraid || '').trim(),
        gbraid: (row.gbraid || '').trim(),
        conversionName: OPSMANTIK_CONVERSION_NAMES.V5_SEAL,
        conversionTime,
        conversionValue,
        conversionCurrency,
        ...(hashedPhone && { hashed_phone_number: hashedPhone }),
      });
    }

    // P0: Fail-closed. If script is exporting (markAsExported=true), terminalize blocked rows so they never loop.
    if (markAsExported && (blockedValueZeroIds.length > 0 || blockedQueueTimeIds.length > 0)) {
      const now = new Date().toISOString();
      const blockedTerminalBatches = [
        {
          ids: [...new Set(blockedQueueTimeIds)],
          code: 'INVALID_CONVERSION_TIME',
          logKey: 'OCI_EXPORT_BLOCKED_TIME',
        },
        {
          ids: [...new Set(blockedValueZeroIds)],
          code: 'VALUE_ZERO',
          logKey: 'OCI_EXPORT_BLOCKED_VALUE_ZERO',
        },
      ].filter((batch) => batch.ids.length > 0);

      for (const batch of blockedTerminalBatches) {
        const { data: blockedRows } = await adminClient
          .from('offline_conversion_queue')
          .select('id')
          .in('id', batch.ids)
          .eq('site_id', siteUuid)
          .eq('status', 'PROCESSING');
        const blockedRowsList = Array.isArray(blockedRows) ? blockedRows as Array<{ id: string }> : [];
        if (blockedRowsList.length !== batch.ids.length) {
          logError(`${batch.logKey}_PROCESSING_MISMATCH`, { requested: batch.ids.length, eligible: blockedRowsList.length });
          return NextResponse.json({ error: 'Blocked queue state mismatch', code: 'QUEUE_STATE_MISMATCH' }, { status: 409 });
        }
        const { data: blockedUpdatedCount, error: blockedUpdateError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: blockedRowsList.map((row) => row.id),
          p_new_status: 'FAILED',
          p_created_at: now,
          p_error_payload: {
            last_error: batch.code,
            provider_error_code: batch.code,
            provider_error_category: 'PERMANENT',
            clear_fields: ['next_retry_at', 'uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
          },
        });
        if (blockedUpdateError || typeof blockedUpdatedCount !== 'number' || blockedUpdatedCount !== blockedRowsList.length) {
          logError(`${batch.logKey}_TERMINALIZE_FAILED`, { code: (blockedUpdateError as { code?: string })?.code, requested: blockedRowsList.length, updated: blockedUpdatedCount });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
      }
    }

    const combined = [...conversions, ...signalItems, ...pvItems].sort(
      (a, b) => (a.conversionTime || '').localeCompare(b.conversionTime || '')
    );

    // Phase 6.2: Compute next_cursor
    // We take the last items from the raw DB pulls (not the combined list which has Redis PVs)
    const lastRow = rawList.length > 0 ? rawList[rawList.length - 1] : null;
    const lastSig = signalList.length > 0 ? signalList[signalList.length - 1] : null;

    let nextCursor: string | null = null;
    if (lastRow || lastSig) {
      const target: ExportCursorState = {
        q: lastRow ? { t: (lastRow as { updated_at: string }).updated_at, i: (lastRow as { id: string }).id } : null,
        s: lastSig ? { t: (lastSig as { created_at: string }).created_at, i: (lastSig as { id: string }).id } : null,
      };
      nextCursor = Buffer.from(JSON.stringify(target)).toString('base64');
    }

    const responseData = markAsExported
      ? { items: combined, next_cursor: nextCursor }
      : {
          siteId: siteUuid,
          items: combined,
          next_cursor: nextCursor,
          counts: { queued: list.length, signals: signalItems.length, pvs: pvItems.length, skipped: skippedIds.length },
          warnings: isGhostCursor ? ['GHOST_CURSOR_FALLBACK_ACTIVE'] : [],
        };

    // Phase 8.2: JWE Asymmetric Payload Protection (Optional side-channel)
    const publicKeyB64 = process.env.VOID_PUBLIC_KEY;
    const wantsJwe = req.headers.get('x-oci-jwe-accept') === 'true';
    if (publicKeyB64 && wantsJwe) {
      try {
        const publicKey = await jose.importSPKI(Buffer.from(publicKeyB64, 'base64').toString('utf8'), 'RS256');
        const jwe = await new jose.CompactEncrypt(
          new TextEncoder().encode(JSON.stringify(responseData))
        )
          .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })
          .encrypt(publicKey);
        return NextResponse.json({ protected: jwe });
      } catch (jweErr) {
        logError('OCI_EXPORT_JWE_FAILED', { error: jweErr instanceof Error ? jweErr.message : String(jweErr) });
      }
    }

    return NextResponse.json(responseData);
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    logError('OCI_EXPORT_FATAL', { error: details });
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
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

function readExportCursorMark(value: unknown): ExportCursorMark | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { t?: unknown; i?: unknown };
  if (typeof row.t !== 'string' || typeof row.i !== 'string' || !row.t || !row.i) return null;
  return { t: row.t, i: row.i };
}
