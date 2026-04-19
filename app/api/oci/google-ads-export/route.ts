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
import { hashE164ForEnhancedConversions } from '@/lib/dic/phone-hash';
import { isCallSendableForSealExport, isCallStatusSendableForSignal } from '@/lib/oci/call-sendability';
import { validateOciQueueValueCents, validateOciSignalConversionValue } from '@/lib/oci/export-value-guard';
import { pickCanonicalOccurredAt } from '@/lib/oci/occurred-at';
import {
  buildSingleConversionGroupKey,
  selectHighestPriorityCandidates,
} from '@/lib/oci/single-conversion-highest-only';
import { createHash } from 'node:crypto';
import * as jose from 'jose';
import { parseExportConfig, getConversionActionConfig } from '@/lib/oci/site-export-config';
import { validateExportRow } from '@/lib/oci/export-gate';
import { getVoidLedgerSalt } from '@/lib/oci/marketing-signal-hash';
import { NEUTRAL_CURRENCY, NEUTRAL_TIMEZONE, resolveSiteLocale } from '@/lib/i18n/site-locale';
// Phase 4 f4-runner-split: types + low-level helpers live in submodules.
import type {
  GoogleAdsConversionItem,
  GoogleAdsAdjustmentItem,
  ExportCursorMark,
  ExportCursorState,
  QueueRow,
  ExportSiteRow,
  RankedExportCandidate,
} from '@/lib/oci/google-ads-export/types';
import {
  resolveSignalStage,
  normalizeSignalChannel,
} from '@/lib/oci/google-ads-export/signal-normalizers';
import {
  ensureNumericValue,
  ensureCurrencyCode,
  readExportCursorMark,
} from '@/lib/oci/google-ads-export/sanitize';

/** P0-1.2: Hard cap to prevent memory exhaustion. Log warning if hit. */
const EXPORT_QUEUE_LIMIT = 1000;
const EXPORT_SIGNALS_LIMIT = 1000;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    let site: ExportSiteRow | null = null;
    const byId = await adminClient.from('sites').select('id, public_id, currency, timezone, oci_sync_method, oci_api_key, oci_config').eq('id', siteId).maybeSingle();
    if (byId.data) {
      site = byId.data as ExportSiteRow;
    }
    if (!site) {
      const byPublicId = await adminClient.from('sites').select('id, public_id, currency, timezone, oci_sync_method, oci_api_key, oci_config').eq('public_id', siteId).maybeSingle();
      if (byPublicId.data) {
        site = byPublicId.data as ExportSiteRow;
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

    // Parse SiteExportConfig (tenant-overridable export contract)
    const exportConfig = parseExportConfig((site as { oci_config?: unknown }).oci_config);

    // Phase 6.2: Deterministic Cursor-Based Query (offline_conversion_queue)
    // Formula: (updated_at, id) > (last_t, last_i)
    let query = adminClient
      .from('offline_conversion_queue')
      .select('id, sale_id, call_id, gclid, wbraid, gbraid, conversion_time, occurred_at, created_at, updated_at, value_cents, optimization_stage, optimization_value, currency, action, external_id, session_id, provider_key')
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
      .select('id, call_id, signal_type, optimization_stage, google_conversion_name, google_conversion_time, occurred_at, conversion_value, optimization_value, gclid, wbraid, gbraid, trace_id, created_at, adjustment_sequence, expected_value_cents, previous_hash, current_hash')
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
    // (the hash feature was introduced after these signals were created). Only signals with
    // a non-null hash are verified against the Void ledger salt.
    //
    // Phase 4 (20260419180000): getVoidLedgerSalt() throws in production when
    // VOID_LEDGER_SALT is unset — there is no insecure fallback anymore. In test
    // and dev environments a deterministic dev salt is used.
    const salt = getVoidLedgerSalt();
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

      const payload = `${s.call_id ?? 'null'}:${s.adjustment_sequence}:${s.expected_value_cents}:${s.previous_hash ?? 'null'}:${salt}`;
      const expectedHash = createHash('sha256').update(payload).digest('hex');

      if (s.current_hash !== expectedHash) {
        // Log the mismatch but do NOT halt the export — stale hashes from a
        // lawful salt rotation should not block revenue signals to Google Ads.
        logWarn('LEDGER_HASH_MISMATCH', {
          signal_id: s.id,
          expected: expectedHash,
          actual: s.current_hash,
          msg: 'Merkle hash mismatch — possible salt rotation or legacy hash. Export continues.',
        });
      }
    }

    // P0-1.3: Use row gclid/wbraid/gbraid if set (Self-Healing recovered), else primary source
    const signalCallIds = signalList
      .map((s) => (s as { call_id?: string | null }).call_id)
      .filter((id): id is string => Boolean(id));
    const sourceMap = await getPrimarySourceBatch(siteUuid, signalCallIds);

    // Fetch call context for Identity Stitcher (caller_phone, fingerprint)
    const { data: callsForStitch } = signalCallIds.length > 0
      ? await adminClient.from('calls').select('id, caller_phone_e164, matched_fingerprint, confirmed_at, created_at, status, intent_action, matched_session_id').eq('site_id', siteUuid).in('id', signalCallIds)
      : { data: [] };
    const callCtxByCallId = new Map<string, { caller_phone_e164?: string; matched_fingerprint?: string; callTime: string; status?: string | null; intentAction?: string | null; matchedSessionId?: string | null }>();
    for (const c of callsForStitch ?? []) {
      const id = (c as { id: string }).id;
      const confirmed = (c as { confirmed_at?: string }).confirmed_at;
      const created = (c as { created_at?: string }).created_at;
      callCtxByCallId.set(id, {
        caller_phone_e164: (c as { caller_phone_e164?: string }).caller_phone_e164 ?? undefined,
        matched_fingerprint: (c as { matched_fingerprint?: string }).matched_fingerprint ?? undefined,
        callTime: confirmed ?? created ?? new Date().toISOString(),
        status: (c as { status?: string | null }).status ?? null,
        intentAction: (c as { intent_action?: string | null }).intent_action ?? null,
        matchedSessionId: (c as { matched_session_id?: string | null }).matched_session_id ?? null,
      });
    }

    const blockedSignalIds: string[] = [];
    const blockedSignalTimeIds: string[] = [];
    const blockedSignalValueIds: string[] = [];
    const signalItems: GoogleAdsConversionItem[] = [];
    const signalCandidates: RankedExportCandidate[] = [];
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
      const signalStage = resolveSignalStage(
        (sig as { optimization_stage?: string | null }).optimization_stage ?? null,
        sigType
      );
      if (!signalStage || signalStage === 'junk') {
        blockedSignalIds.push((sig as { id: string }).id);
        logWarn('OCI_EXPORT_SIGNAL_SKIP_UNKNOWN_STAGE', {
          signal_id: (sig as { id: string }).id,
          call_id: callId,
          signal_type: sigType || null,
          optimization_stage: (sig as { optimization_stage?: string | null }).optimization_stage ?? null,
        });
        continue;
      }
      const signalChannel = normalizeSignalChannel(ctx?.intentAction);
      const signalActionCfg =
        signalChannel
          ? getConversionActionConfig(exportConfig, signalChannel, signalStage)
          : null;
      const conversionName = signalActionCfg?.action_name || (sig as { google_conversion_name: string }).google_conversion_name || 'OpsMantik_Contacted';

      const rowValue =
        (sig as { optimization_value?: number | null }).optimization_value ??
        (sig as { conversion_value?: number | null }).conversion_value;
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
      const item: GoogleAdsConversionItem = {
        id: `signal_${signalRowId}`,
        orderId: orderIdDDA || `signal_${signalRowId}`,
        gclid: gclid || '',
        wbraid: wbraid || '',
        gbraid: gbraid || '',
        conversionName,
        conversionTime,
        conversionValue: numVal,
        conversionCurrency: (site as { currency?: string })?.currency || NEUTRAL_CURRENCY,
        ...(traceId && { om_trace_uuid: traceId }),
      };
      signalItems.push(item);
      signalCandidates.push({
        id: item.id,
        groupKey: buildSingleConversionGroupKey(ctx?.matchedSessionId ?? null, callId, signalRowId),
        gear: signalStage,
        sortKey: item.conversionTime,
        value: item,
      });
    }

    // PENDING signals without click_id are left for Self-Healing Pulse to retry (no SKIPPED update here)

    const pvItems: GoogleAdsConversionItem[] = [];

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

    // ── Session Click Dates (Fix: 90-day expiry + conversion-before-click guard) ──
    // Collect session_id values directly from queue rows (already selected).
    // session.created_at = when the visitor first landed with gclid/wbraid → true click date.
    const sessionClickDateById = new Map<string, Date>();
    const rawSessionIds = [...new Set(
      rawList
        .map(r => (r as { session_id?: string | null }).session_id)
        .filter((s): s is string => Boolean(s))
    )];
    if (rawSessionIds.length > 0) {
      const { data: sessionRows } = await adminClient
        .from('sessions')
        .select('id, created_at')
        .in('id', rawSessionIds);
      for (const s of sessionRows ?? []) {
        const d = new Date((s as { created_at: string }).created_at);
        if (!isNaN(d.getTime())) {
          sessionClickDateById.set((s as { id: string }).id, d);
        }
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
    const list = byConversionTime;

    const siteLocale = resolveSiteLocale(site as { currency?: string | null; timezone?: string | null });
    const currency = siteLocale.currency;

    const siteTimezone = siteLocale.timezone;

    const conversions: GoogleAdsConversionItem[] = [];
    const queueCandidates: RankedExportCandidate[] = [];
    const blockedQueueTimeIds: string[] = [];
    const blockedValueZeroIds: string[] = [];
    const blockedExpiredIds: string[] = [];
    /** Gate rejections: UNKNOWN_ACTION, NO_CLICK_ID, OCT_NO_IDENTIFIER, etc. */
    const blockedExportGateIds: string[] = [];
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

      const rowClickDate = row.session_id ? sessionClickDateById.get(row.session_id) : null;

      // ── Guard 1: Conversion-Before-Click Prevention ───────────────────────
      // Google rejects: "Conversion time precedes click time".
      // If conversionTime < session.created_at, clamp to clickDate + 1 minute.
      // This handles timezone mismatches and sub-minute race conditions.
      let finalConversionTime = conversionTime;
      if (rowClickDate && baseTs) {
        const convDate = new Date(baseTs);
        const minAllowed = new Date(rowClickDate.getTime() + 60_000); // +1 min safety margin
        if (convDate < minAllowed) {
          finalConversionTime = formatGoogleAdsTimeOrNull(minAllowed.toISOString(), siteTimezone) ?? conversionTime;
          logWarn('OCI_EXPORT_CONVERSION_BEFORE_CLICK_CLAMPED', {
            queue_id: row.id,
            call_id: row.call_id ?? null,
            click_date: rowClickDate.toISOString(),
            original: conversionTime,
            clamped_to: finalConversionTime,
          });
        }
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
      const rowCurrency = row.currency || currency || NEUTRAL_CURRENCY;
      const conversionValue = ensureNumericValue(
        typeof row.optimization_value === 'number' && Number.isFinite(row.optimization_value)
          ? row.optimization_value
          : minorToMajor(valueCents, rowCurrency)
      );
      const conversionCurrency = ensureCurrencyCode(row.currency || currency || NEUTRAL_CURRENCY);
      const fallbackOrderId = 'seal_' + String(row.id);
      const externalId = row.external_id || computeOfflineConversionExternalId({
        providerKey: row.provider_key,
        action: row.action,
        saleId: row.sale_id,
        callId: row.call_id,
        sessionId: row.session_id,
      });
      const rowChannel = 'phone';
      const v5ActionCfg = getConversionActionConfig(exportConfig, rowChannel, 'won');
      const convName = v5ActionCfg?.action_name ?? OPSMANTIK_CONVERSION_NAMES.won;
      if (v5ActionCfg) {
        logInfo('OCI_EXPORT_SEAL_ROLE', {
          queue_id: row.id,
          channel: rowChannel,
          action: convName,
          role: v5ActionCfg.role,
        });
      }

      // SSOT: route through hashE164ForEnhancedConversions so this matches the
      // hash that seal/stage write to calls.caller_phone_hash_sha256 byte for
      // byte. The helper never throws; if it returns null the gate still has
      // gclid/wbraid/gbraid to fall back on.
      const hashedPhoneForGate = row.call_id
        ? hashE164ForEnhancedConversions(callPhoneByCallId[row.call_id])
        : null;

      const signalDateForGate = baseTs ? new Date(baseTs) : new Date();
      const gateResult = validateExportRow(
        {
          id: row.id,
          gclid: row.gclid,
          wbraid: row.wbraid,
          gbraid: row.gbraid,
          hashed_phone: hashedPhoneForGate,
          hashed_email: null,
          value_cents: valueCents,
          click_date: rowClickDate ?? null,
          signal_date: signalDateForGate,
        },
        exportConfig,
        v5ActionCfg
      );

      if (!gateResult.ok) {
        if (gateResult.reason === 'EXPIRED') {
          blockedExpiredIds.push(row.id);
          logWarn('OCI_EXPORT_SKIP_EXPIRED_CLICK', {
            queue_id: row.id,
            call_id: row.call_id ?? null,
            gate_reason: gateResult.reason,
          });
        } else if (gateResult.reason === 'ZERO_VALUE') {
          blockedValueZeroIds.push(row.id);
        } else {
          blockedExportGateIds.push(row.id);
          logWarn('OCI_EXPORT_GATE_REJECT', {
            queue_id: row.id,
            call_id: row.call_id ?? null,
            reason: gateResult.reason,
          });
        }
        continue;
      }

      const effectiveClickId = gateResult.clickId;
      const orderIdDDA = buildOrderId(
        convName,
        effectiveClickId || null,
        finalConversionTime,
        fallbackOrderId,
        row.id,
        valueCents
      );

      let gclidOut = '';
      let wbraidOut = '';
      let gbraidOut = '';
      let hashedPhoneOut: string | null = null;
      switch (gateResult.clickSource) {
        case 'gclid':
          gclidOut = gateResult.clickId;
          break;
        case 'wbraid':
          wbraidOut = gateResult.clickId;
          break;
        case 'gbraid':
          gbraidOut = gateResult.clickId;
          break;
        case 'oct_phone':
          hashedPhoneOut = gateResult.clickId;
          break;
        case 'oct_email':
          hashedPhoneOut = gateResult.clickId;
          break;
        case 'no_id':
          break;
        default:
          gclidOut = (row.gclid || '').trim();
          wbraidOut = (row.wbraid || '').trim();
          gbraidOut = (row.gbraid || '').trim();
          if (hashedPhoneForGate) hashedPhoneOut = hashedPhoneForGate;
      }

      const item: GoogleAdsConversionItem = {
        id: fallbackOrderId,
        orderId: externalId || orderIdDDA || fallbackOrderId,
        gclid: gclidOut,
        wbraid: wbraidOut,
        gbraid: gbraidOut,
        conversionName: convName,
        conversionTime: finalConversionTime,
        conversionValue,
        conversionCurrency,
        ...(hashedPhoneOut && { hashed_phone_number: hashedPhoneOut }),
        ...(v5ActionCfg && { _role: v5ActionCfg.role }),
      };
      conversions.push(item);
      queueCandidates.push({
        id: item.id,
        groupKey: buildSingleConversionGroupKey(row.session_id ?? (row.call_id ? sessionByCall[row.call_id] ?? null : null), row.call_id ?? null, row.id),
        gear: 'won',
        sortKey: item.conversionTime,
        value: item,
      });
    }

    const rankedCandidates = [...queueCandidates, ...signalCandidates];
    const { kept: keptCandidates, suppressed: suppressedCandidates } = selectHighestPriorityCandidates(rankedCandidates);
    const rankedCandidateIds = new Set(rankedCandidates.map((candidate) => candidate.id));
    const keptCandidateIds = new Set(keptCandidates.map((candidate) => candidate.id));
    const keptConversions = conversions.filter((item) => !rankedCandidateIds.has(item.id) || keptCandidateIds.has(item.id));
    const keptSignalItems = signalItems.filter((item) => !rankedCandidateIds.has(item.id) || keptCandidateIds.has(item.id));
    const suppressedQueueIds = suppressedCandidates
      .filter((candidate) => candidate.id.startsWith('seal_'))
      .map((candidate) => candidate.id.replace('seal_', ''));
    const suppressedSignalIds = suppressedCandidates
      .filter((candidate) => candidate.id.startsWith('signal_'))
      .map((candidate) => candidate.id.replace('signal_', ''));
    const idsToMarkProcessing = keptConversions.map((item) => item.id.replace('seal_', ''));
    const signalIdsToMarkProcessing = keptSignalItems.map((item) => item.id.replace('signal_', ''));

    if (suppressedCandidates.length > 0) {
      logInfo('OCI_EXPORT_SUPPRESSED_LOWER_GEARS', {
        site_id: siteUuid,
        suppressed_queue: suppressedQueueIds.length,
        suppressed_signals: suppressedSignalIds.length,
      });
    }

    if (
      markAsExported &&
      (
        idsToMarkProcessing.length > 0 ||
        suppressedQueueIds.length > 0 ||
        signalIdsToMarkProcessing.length > 0 ||
        suppressedSignalIds.length > 0 ||
        blockedQueueIds.length > 0 ||
        blockedSignalIds.length > 0 ||
        blockedSignalTimeIds.length > 0 ||
        blockedSignalValueIds.length > 0
      )
    ) {
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
          logError('OCI_GOOGLE_ADS_EXPORT_CLAIM_FAILED', { code: (rpcError as { code?: string })?.code });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        if (typeof claimedCount !== 'number' || claimedCount !== idsToMarkProcessing.length) {
          logError('OCI_GOOGLE_ADS_EXPORT_CLAIM_PARTIAL', {
            requested: idsToMarkProcessing.length,
            claimed: claimedCount,
          });
          return NextResponse.json({ error: 'Queue claim mismatch', code: 'QUEUE_CLAIM_MISMATCH' }, { status: 409 });
        }
      }
      if (suppressedQueueIds.length > 0) {
        const { data: suppressedClaimedCount, error: suppressedClaimError } = await adminClient.rpc(
          'append_script_claim_transition_batch',
          { p_queue_ids: suppressedQueueIds, p_claimed_at: now }
        );
        if (suppressedClaimError || typeof suppressedClaimedCount !== 'number' || suppressedClaimedCount !== suppressedQueueIds.length) {
          logError('OCI_GOOGLE_ADS_EXPORT_SUPPRESS_CLAIM_FAILED', {
            code: (suppressedClaimError as { code?: string })?.code,
            requested: suppressedQueueIds.length,
            claimed: suppressedClaimedCount,
          });
          return NextResponse.json({ error: 'Suppressed queue claim mismatch', code: 'QUEUE_CLAIM_MISMATCH' }, { status: 409 });
        }

        const { data: suppressedRows } = await adminClient
          .from('offline_conversion_queue')
          .select('id')
          .in('id', suppressedQueueIds)
          .eq('site_id', siteUuid)
          .eq('status', 'PROCESSING');
        const suppressedRowsList = Array.isArray(suppressedRows) ? suppressedRows as Array<{ id: string }> : [];
        if (suppressedRowsList.length !== suppressedQueueIds.length) {
          logError('OCI_GOOGLE_ADS_EXPORT_SUPPRESS_PROCESSING_MISMATCH', { requested: suppressedQueueIds.length, processing: suppressedRowsList.length });
          return NextResponse.json({ error: 'Suppressed queue state mismatch', code: 'QUEUE_STATE_MISMATCH' }, { status: 409 });
        }
        const { data: suppressedUpdatedCount, error: suppressedUpdateError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: suppressedRowsList.map((row) => row.id),
          p_new_status: 'COMPLETED',
          p_created_at: now,
          p_error_payload: {
            uploaded_at: now,
            last_error: 'SUPPRESSED_BY_HIGHER_GEAR',
            provider_error_code: 'SUPPRESSED_BY_HIGHER_GEAR',
            provider_error_category: 'DETERMINISTIC_SKIP',
            clear_fields: ['next_retry_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
          },
        });
        if (suppressedUpdateError || typeof suppressedUpdatedCount !== 'number' || suppressedUpdatedCount !== suppressedRowsList.length) {
          logError('OCI_GOOGLE_ADS_EXPORT_SUPPRESS_TERMINALIZE_FAILED', { code: (suppressedUpdateError as { code?: string })?.code, requested: suppressedRowsList.length, updated: suppressedUpdatedCount });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
      }
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
      if (suppressedSignalIds.length > 0) {
        const { data, error: suppressedSignalsError } = await adminClient
          .from('marketing_signals')
          // Strict signal state-machine does not allow PENDING -> FAILED directly.
          .update({ dispatch_status: 'JUNK_ABORTED' })
          .in('id', suppressedSignalIds)
          .eq('site_id', siteUuid)
          .eq('dispatch_status', 'PENDING')
          .select('id');
        if (suppressedSignalsError) {
          logError('OCI_EXPORT_SUPPRESSED_SIGNALS_ABORT_FAILED', { error: suppressedSignalsError.message });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        const updatedSuppressedSignals = Array.isArray(data) ? data.length : 0;
        if (updatedSuppressedSignals !== suppressedSignalIds.length) {
          logError('OCI_EXPORT_SUPPRESSED_SIGNALS_ABORT_MISMATCH', { requested: suppressedSignalIds.length, updated: updatedSuppressedSignals });
          return NextResponse.json({ error: 'Signal state mismatch', code: 'SIGNAL_STATE_MISMATCH' }, { status: 409 });
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
          // Keep abort deterministic while staying within allowed transition matrix.
          .update({ dispatch_status: 'JUNK_ABORTED' })
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
          // Keep abort deterministic while staying within allowed transition matrix.
          .update({ dispatch_status: 'JUNK_ABORTED' })
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

    // P0: Fail-closed. If script is exporting (markAsExported=true), terminalize blocked rows so they never loop.
    if (
      markAsExported &&
      (blockedValueZeroIds.length > 0 ||
        blockedQueueTimeIds.length > 0 ||
        blockedExpiredIds.length > 0 ||
        blockedExportGateIds.length > 0)
    ) {
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
        {
          // Google 90-day hard limit: EXPIRED_CLICK rows are permanently rejected.
          // Terminate as FAILED so they don't loop back into the export queue.
          ids: [...new Set(blockedExpiredIds)],
          code: 'EXPIRED_CLICK',
          logKey: 'OCI_EXPORT_BLOCKED_EXPIRED',
        },
        {
          ids: [...new Set(blockedExportGateIds)],
          code: 'EXPORT_GATE_REJECTED',
          logKey: 'OCI_EXPORT_BLOCKED_GATE',
        },
      ].filter((batch) => batch.ids.length > 0);

      for (const batch of blockedTerminalBatches) {
        const { data: blockedClaimedCount, error: blockedClaimError } = await adminClient.rpc(
          'append_script_claim_transition_batch',
          { p_queue_ids: batch.ids, p_claimed_at: now }
        );
        if (blockedClaimError || typeof blockedClaimedCount !== 'number' || blockedClaimedCount !== batch.ids.length) {
          logError(`${batch.logKey}_CLAIM_FAILED`, {
            code: (blockedClaimError as { code?: string })?.code,
            requested: batch.ids.length,
            claimed: blockedClaimedCount,
          });
          return NextResponse.json({ error: 'Blocked queue claim mismatch', code: 'QUEUE_CLAIM_MISMATCH' }, { status: 409 });
        }

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

    const combined = [...keptConversions, ...keptSignalItems, ...pvItems].sort(
      (a, b) => (a.conversionTime || '').localeCompare(b.conversionTime || '')
    );

    // Modül 1: Load pending adjustments for this site
    const adjustmentItems: GoogleAdsAdjustmentItem[] = [];
    if (exportConfig.adjustments.enabled) {
      const { data: pendingAdjs, error: adjError } = await adminClient
        .from('conversion_adjustments')
        .select('id, order_id, conversion_action_name, adjustment_type, new_value_cents, created_at')
        .eq('site_id', siteUuid)
        .eq('status', 'PENDING')
        .limit(200);

      if (adjError) {
        logError('OCI_EXPORT_ADJUSTMENTS_FETCH_ERROR', { error: adjError.message, site_id: siteUuid });
      } else {
        const adjCurrency = (site as { currency?: string })?.currency || NEUTRAL_CURRENCY;
        const now = new Date().toISOString();
        for (const adj of (pendingAdjs ?? []) as Array<{
          id: string;
          order_id: string;
          conversion_action_name: string;
          adjustment_type: 'RETRACTION' | 'RESTATEMENT';
          new_value_cents?: number | null;
          created_at: string;
        }>) {
          const item: GoogleAdsAdjustmentItem = {
            id: `adj_${adj.id}`,
            orderId: adj.order_id,
            conversionName: adj.conversion_action_name,
            adjustmentType: adj.adjustment_type,
            adjustmentTime: formatGoogleAdsTimeOrNull(now, (site as { timezone?: string | null }).timezone ?? NEUTRAL_TIMEZONE) ?? now,
          };
          if (adj.adjustment_type === 'RESTATEMENT' && adj.new_value_cents != null) {
            item.adjustedValue = minorToMajor(adj.new_value_cents, adjCurrency);
            item.adjustedCurrency = adjCurrency;
          }
          adjustmentItems.push(item);
        }

        // Mark adjustments as PROCESSING if markAsExported
        if (markAsExported && adjustmentItems.length > 0) {
          const adjIds = adjustmentItems.map(a => a.id.replace('adj_', ''));
          await adminClient
            .from('conversion_adjustments')
            .update({ status: 'PROCESSING', updated_at: new Date().toISOString() })
            .in('id', adjIds)
            .eq('site_id', siteUuid)
            .eq('status', 'PENDING');
        }
      }
    }

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
      ? { items: combined, adjustments: adjustmentItems, next_cursor: nextCursor }
      : {
          siteId: siteUuid,
          items: combined,
          adjustments: adjustmentItems,
          next_cursor: nextCursor,
          counts: {
            queued: keptConversions.length,
            signals: keptSignalItems.length,
            pvs: pvItems.length,
            suppressed: suppressedCandidates.length,
            adjustments: adjustmentItems.length,
          },
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


