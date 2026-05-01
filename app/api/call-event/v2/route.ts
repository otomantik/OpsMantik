import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';

import { createHash } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { buildCallEventIngestWorkerBody, publishCallEventIngestWorker } from '@/lib/ingest/call-event-queue-command';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { ReplayCacheService } from '@/lib/services/replay-cache-service';
import { getIngestCorsHeaders } from '@/lib/security/cors';
import { SITE_PUBLIC_ID_RE, SITE_UUID_RE, isValidSiteIdentifier } from '@/lib/security/site-identifier';
import { getRecentMonths } from '@/lib/sync-utils';
import { logError, logWarn } from '@/lib/logging/logger';
import {
  getEventIdModeFromEnv,
  inferIntentAction,
  isMissingResolveRpcError,
  isRecord,
  makeIntentStamp,
  normalizePhoneTarget,
  parseValueAllowNull,
  type EventIdMode,
} from '@/lib/api/call-event/shared';
import { findRecentSessionByFingerprint, BRIDGE_LOOKBACK_DAYS } from '@/lib/api/call-event/match-session-by-fingerprint';
import { AdsContextOptionalSchema } from '@/lib/ingest/call-event-worker-payload';
import { requireModule, ModuleNotEnabledError } from '@/lib/auth/require-module';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { recordRouteHttpResponse } from '@/lib/route-metrics';
import { applyRefactorObservability } from '@/lib/refactor/phase-context';
import { getRefactorFlags } from '@/lib/refactor/flags';
import {
  applyConsentProvenanceShadowMetrics,
  evaluateConsentProvenanceShadow,
} from '@/lib/compliance/consent-provenance-shadow';
import { digestCallEventMatchInputs, recordInferenceRunBestEffort } from '@/lib/domain/truth/inference-run-writer';
import { appendIdentityGraphEdgeBestEffort } from '@/lib/domain/truth/identity-graph-writer';
import { sanitizeClickId } from '@/lib/attribution';
import { shouldReuseSessionV1 } from '@/lib/intents/session-reuse-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/call-event/v2';
const OPSMANTIK_VERSION = '2.0.0-proxy';

const MAX_BODY_BYTES = 64 * 1024;
const CALL_EVENT_MODULE_GATE_FAIL_OPEN =
  process.env.CALL_EVENT_MODULE_GATE_FAIL_OPEN === '1' ||
  process.env.CALL_EVENT_MODULE_GATE_FAIL_OPEN === 'true';
const SESSION_REUSE_HARDENING_ENABLED =
  process.env.INTENT_SESSION_REUSE_HARDENING === '1' ||
  process.env.INTENT_SESSION_REUSE_HARDENING === 'true' ||
  process.env.INTENT_SESSION_REUSE_HARDENING === 'on';

function hashTarget(value: string | null): string | null {
  if (!value) return null;
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

function getEventIdMode(): EventIdMode {
  return getEventIdModeFromEnv();
}

// V2 payload is identical to V1 but adds event_id (for upcoming idempotency). Sprint 3: shared AdsContext Zod.
const CallEventV2Schema = z
  .object({
    event_id: z.string().uuid().optional(),
    site_id: z
      .string()
      .min(1)
      .max(64)
      .refine(isValidSiteIdentifier, 'Invalid site_id'),
    fingerprint: z.string().min(1).max(128),
    phone_number: z.string().max(256).nullable().optional(),
    // Proxy/tracker context (accepted, not required)
    action: z.string().max(32).nullable().optional(),
    url: z.string().max(2048).nullable().optional(),
    ua: z.string().max(512).nullable().optional(),
    value: z.union([z.number(), z.string(), z.null()]).optional(),
    intent_action: z.string().max(32).nullable().optional(),
    intent_target: z.string().max(512).nullable().optional(),
    intent_stamp: z.string().max(128).nullable().optional(),
    intent_page_url: z.string().max(2048).nullable().optional(),
    click_id: z.string().max(256).nullable().optional(),
    gclid: z.string().max(256).nullable().optional(),
    wbraid: z.string().max(256).nullable().optional(),
    gbraid: z.string().max(256).nullable().optional(),
    // Google Ads ValueTrack enrichment (Sprint 3: shared Zod schema)
    ads_context: AdsContextOptionalSchema,
  })
  .strict();

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = getIngestCorsHeaders(origin, { 'X-OpsMantik-Version': OPSMANTIK_VERSION });
  const res = new NextResponse(null, { status: 200, headers });
  if (origin) res.headers.set('Access-Control-Allow-Credentials', 'true');
  return res;
}

async function callEventV2Inner(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? undefined;
  Sentry.setTag('route', ROUTE);

  try {
    const origin = req.headers.get('origin');
    const baseHeaders: Record<string, string> = {
      ...getIngestCorsHeaders(origin, { 'X-OpsMantik-Version': OPSMANTIK_VERSION }),
    };

    // Read raw body for signature + size guard
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: baseHeaders });
    }

    const clientId = RateLimitService.getClientId(req);

    // COMPLIANCE INVARIANT — Route order (DO NOT change):
    // 1) HMAC verify — MUST run first. Consent before HMAC = signature brute-force risk.
    // 2) Replay check  3) Rate limit  4) Session lookup  5) Analytics consent gate  6) Insert  7) OCI enqueue (seal).
    //
    // Auth boundary: verify signature before any write/ingest operation.
    // Rollback switch: set CALL_EVENT_SIGNING_DISABLED=1 to temporarily accept unsigned calls.
    const signingDisabled =
      process.env.CALL_EVENT_SIGNING_DISABLED === '1' || process.env.CALL_EVENT_SIGNING_DISABLED === 'true';

    let headerSiteId = '';
    let headerSig = '';
    if (!signingDisabled) {
      // Signature headers (fail-closed)
      headerSiteId = (req.headers.get('x-ops-site-id') || '').trim();
      const headerTs = (req.headers.get('x-ops-ts') || '').trim();
      headerSig = (req.headers.get('x-ops-signature') || '').trim();

      if (
        !headerSiteId ||
        !(SITE_PUBLIC_ID_RE.test(headerSiteId) || SITE_UUID_RE.test(headerSiteId)) ||
        !/^\d{9,12}$/.test(headerTs) ||
        !/^[0-9a-f]{64}$/i.test(headerSig)
      ) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
      }

      const tsNum = Number(headerTs);
      const nowSec = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(tsNum) || nowSec - tsNum > 300 || tsNum - nowSec > 60) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
      }

      const { data: sigOk, error: sigErr } = await adminClient.rpc('verify_call_event_signature_v1', {
        p_site_public_id: headerSiteId,
        p_ts: tsNum,
        p_raw_body: rawBody,
        p_signature: headerSig,
      });
      const verifySignatureFnMissing =
        Boolean(sigErr?.message?.toLowerCase().includes('verify_call_event_signature_v1')) &&
        Boolean(sigErr?.message?.toLowerCase().includes('does not exist'));
      if (verifySignatureFnMissing) {
        logWarn('call-event-v2 signature RPC missing, bypassing signature verify', {
          request_id: requestId,
          route: ROUTE,
          site_id: headerSiteId,
        });
      } else if (sigErr || sigOk !== true) {
        logWarn('call-event-v2 signature rejected', { request_id: requestId, route: ROUTE, site_id: headerSiteId, error: sigErr?.message });
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
      }
    } else {
      logWarn('call-event-v2 signing disabled (rollback mode)', { request_id: requestId, route: ROUTE });
    }

    // JSON parse + strict validation
    let bodyJson: unknown;
    try {
      bodyJson = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
      logWarn('call-event-v2 invalid json body', { request_id: requestId, route: ROUTE, error: String((e as Error)?.message ?? e) });
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: baseHeaders });
    }
    if (!isRecord(bodyJson)) return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: baseHeaders });
    // COMPLIANCE: Reject consent escalation — call-event must NOT accept or modify consent.
    if ('consent_scopes' in bodyJson || 'consent_at' in bodyJson) {
      return NextResponse.json({ error: 'Invalid body', hint: 'consent_scopes and consent_at are not allowed' }, { status: 400, headers: baseHeaders });
    }
    const parsed = CallEventV2Schema.safeParse(bodyJson);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: baseHeaders });

    const body = parsed.data;
    // Resolve site identifier BEFORE service-role DB access (UUID or public_id -> canonical UUID).
    // Back-compat: if resolver RPC isn't deployed yet, fall back to legacy public_id-only flow.
    let resolvedSiteUuid: string | null = null;
    let legacyPublicId: string | null = null;

    const { data: resolvedBodySiteId, error: resolveBodyErr } = await adminClient.rpc('resolve_site_identifier_v1', {
      p_input: body.site_id,
    });
    if (resolveBodyErr) {
      if (!isMissingResolveRpcError(resolveBodyErr)) {
        logWarn('call-event-v2 resolve_site_identifier_v1 failed, using legacy path', {
          request_id: requestId,
          route: ROUTE,
          message: resolveBodyErr.message,
        });
      }
      if (!SITE_PUBLIC_ID_RE.test(body.site_id)) return NextResponse.json({ error: 'Invalid site_id' }, { status: 400, headers: baseHeaders });
      if (!signingDisabled && (!SITE_PUBLIC_ID_RE.test(headerSiteId) || headerSiteId !== body.site_id)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
      }
      legacyPublicId = body.site_id;
    } else {
      if (!resolvedBodySiteId) return NextResponse.json({ error: 'Invalid site_id' }, { status: 400, headers: baseHeaders });
      resolvedSiteUuid = resolvedBodySiteId;

      // Enforce header/body binding when signing is enabled (prevents cross-site signature reuse).
      if (!signingDisabled) {
        const { data: resolvedHeaderSiteId, error: resolveHeaderErr } = await adminClient.rpc('resolve_site_identifier_v1', {
          p_input: headerSiteId,
        });
        if (resolveHeaderErr || !resolvedHeaderSiteId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
        if (resolvedHeaderSiteId !== resolvedSiteUuid) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
        }
      }
    }

    // site_id is canonical UUID when resolver exists; otherwise derived later in legacy mode.
    let site_id: string | null = resolvedSiteUuid;
    const fingerprint = body.fingerprint;
    const phone_number = typeof body.phone_number === 'string' ? body.phone_number : null;
    const eventIdMode = getEventIdMode();
    const event_id = eventIdMode !== 'off' ? (body.event_id ?? null) : null;
    const eventIdColumnOk = eventIdMode === 'on';
    const value = parseValueAllowNull(body.value);

    // Replay cache. Phase 14: fail if site unresolved; no 'unknown'.
    const replaySiteKey = resolvedSiteUuid ?? legacyPublicId;
    if (!replaySiteKey) {
      return NextResponse.json({ error: 'Site not resolved' }, { status: 400, headers: baseHeaders });
    }
    const replayKey = ReplayCacheService.makeReplayKey({ siteId: replaySiteKey, eventId: event_id, signature: headerSig || null });
    const replay = await ReplayCacheService.checkAndStore(replayKey, 10 * 60 * 1000, { mode: 'degraded', namespace: 'call-event-v2' });
    if (replay.isReplay) {
      if (event_id && eventIdColumnOk && resolvedSiteUuid) {
        const { data: existing } = await adminClient
          .from('calls')
          .select('id, matched_session_id, lead_score')
          .eq('site_id', resolvedSiteUuid)
          .eq('event_id', event_id)
          .single();
        if (existing?.id) {
          return NextResponse.json(
            { status: 'noop', call_id: existing.id, session_id: existing.matched_session_id ?? null, lead_score: existing.lead_score ?? null },
            { status: 200, headers: baseHeaders }
          );
        }
      }
      return NextResponse.json({ status: 'noop' }, { status: 200, headers: baseHeaders });
    }

    // Canonical site UUID for DB operations.
    let siteUuid = resolvedSiteUuid;
    let dailyLimit = 1000;
    let siteRow: { id: string; daily_lead_limit?: number; active_modules?: string[] | null } | null = null;
    if (!siteUuid) {
      const { data: sCore, error: sCoreErr } = await adminClient
        .from('sites')
        .select('id, active_modules')
        .eq('public_id', legacyPublicId)
        .single();
      if (sCoreErr || !sCore?.id) return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: baseHeaders });
      siteUuid = sCore.id;
      siteRow = { id: sCore.id, active_modules: sCore.active_modules ?? null };

      // Some environments may miss daily_lead_limit temporarily; keep module-gate healthy and fall back to 1000.
      const { data: sLimit, error: sLimitErr } = await adminClient
        .from('sites')
        .select('daily_lead_limit')
        .eq('id', sCore.id)
        .single();
      if (!sLimitErr) dailyLimit = sLimit?.daily_lead_limit ?? 1000;
    } else {
      const { data: sCore, error: sCoreErr } = await adminClient
        .from('sites')
        .select('id, active_modules')
        .eq('id', siteUuid)
        .single();
      if (sCoreErr || !sCore?.id) return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: baseHeaders });
      siteRow = { id: sCore.id, active_modules: sCore.active_modules ?? null };

      const { data: sLimit, error: sLimitErr } = await adminClient
        .from('sites')
        .select('daily_lead_limit')
        .eq('id', siteUuid)
        .single();
      if (!sLimitErr) dailyLimit = sLimit?.daily_lead_limit ?? 1000;
    }

    if (!siteUuid) return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: baseHeaders });

    applyRefactorObservability({ route_name: ROUTE, site_id: siteUuid });

    try {
      await requireModule({ siteId: siteUuid, requiredModule: 'core_oci', site: siteRow ?? undefined });
    } catch (err) {
      if (err instanceof ModuleNotEnabledError) {
        if (CALL_EVENT_MODULE_GATE_FAIL_OPEN) {
          // Temporary rollback switch: allow signed ingest even when module flags are stale.
          logWarn('call-event-v2 module gate bypassed (fail-open override)', {
            request_id: requestId,
            route: ROUTE,
            site_id: siteUuid,
            required_module: 'core_oci',
          });
        } else {
          return NextResponse.json(
            { error: 'Module not enabled', code: 'MODULE_NOT_ENABLED', required_module: 'core_oci' },
            { status: 403, headers: { ...baseHeaders, ...getBuildInfoHeaders() } }
          );
        }
      } else {
        throw err;
      }
    }

    // ── ARCHITECTURAL HARDENING: Daily Quota (Noisy Neighbor Protection) ────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: leadCount } = await adminClient
      .from('calls')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', siteUuid)
      .gte('matched_at', todayStart.toISOString());

    if (leadCount !== null && leadCount >= dailyLimit) {
      logWarn('Daily lead quota exceeded', { site_id: siteUuid, count: leadCount, limit: dailyLimit });
      return NextResponse.json(
        { error: 'Daily quota exceeded', limit: dailyLimit },
        { status: 429, headers: baseHeaders }
      );
    }
    const siteUuidFinal: string = siteUuid;
    site_id = siteUuidFinal;
    const site = { id: siteUuidFinal } as const;

    // Per-site(+proxy host) rate limiting (blast-radius isolation).
    const proxyHostRaw = (req.headers.get('x-ops-proxy-host') || '').trim().toLowerCase();
    const proxyHost = proxyHostRaw && proxyHostRaw.length <= 255 ? proxyHostRaw.replace(/[^a-z0-9.-]/g, '').slice(0, 128) : 'unknown';
    const CALL_EVENT_RL_LIMIT = 150; // per site|proxy|client per minute (burst: multiple clicks + retries)
    const rl = await RateLimitService.checkWithMode(`${siteUuidFinal}|${proxyHost}|${clientId}`, CALL_EVENT_RL_LIMIT, 60 * 1000, {
      mode: 'fail-closed',
      namespace: 'call-event-v2',
    });
    if (!rl.allowed) {
      const isRedisDown = rl.redisUnavailable === true;
      return NextResponse.json(
        { error: isRedisDown ? 'Rate limit service temporarily unavailable' : 'Rate limit exceeded', retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
        {
          status: rl.redisUnavailable ? 503 : 429,
          headers: {
            ...baseHeaders,
            'X-RateLimit-Limit': String(CALL_EVENT_RL_LIMIT),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rl.resetAt.toString(),
            'Retry-After': Math.ceil((rl.resetAt - Date.now()) / 1000).toString(),
          },
        }
      );
    }
    // Per-fingerprint rate limit (brute-force session probing guard)
    const FINGERPRINT_RL_LIMIT = 20;
    const rlFp = await RateLimitService.checkWithMode(`fp:${siteUuidFinal}:${fingerprint}`, FINGERPRINT_RL_LIMIT, 60 * 1000, {
      mode: 'fail-closed',
      namespace: 'call-event-v2',
    });
    if (!rlFp.allowed) {
      const isRedisDown = rlFp.redisUnavailable === true;
      return NextResponse.json(
        { error: isRedisDown ? 'Rate limit service temporarily unavailable' : 'Rate limit exceeded', retryAfter: Math.ceil((rlFp.resetAt - Date.now()) / 1000) },
        {
          status: rlFp.redisUnavailable ? 503 : 429,
          headers: {
            ...baseHeaders,
            'X-RateLimit-Limit': String(FINGERPRINT_RL_LIMIT),
            'Retry-After': Math.ceil((rlFp.resetAt - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    // COMPLIANCE INVARIANT:
    // Call-event must not bypass analytics consent.
    // No call insert without session analytics consent.
    // Marketing consent required for OCI enqueue (enforce in enqueueSealConversion and canonical sale queue RPCs).
    //
    // Find best session by fingerprint (PR-OCI-7.4: GCLID-preferring, 14-day lookback).
    const lookbackCutoff = new Date(Date.now() - BRIDGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const recentMonths = getRecentMonths(2);
    const matchedAt = new Date().toISOString();
    const matchResult = await findRecentSessionByFingerprint(adminClient, {
      siteId: siteUuidFinal,
      fingerprint,
      recentMonths,
      lookbackCutoff,
      callTime: matchedAt,
    });

    let matchedSessionId = matchResult.matchedSessionId;
    let matchedSessionMonth = matchResult.sessionMonth;
    const leadScore = matchResult.leadScore;

    // COMPLIANCE: Analytics consent gate. No session OR analytics missing → 204, no insert, no OCI.
    // Side-channel mitigation: 204 response identical for (no session) and (no analytics) — same body, same headers.
    const CONSENT_MISSING_HEADERS = { ...baseHeaders, 'x-opsmantik-consent-missing': 'analytics' } as const;
    const consentScopes = (matchResult.consentScopes ?? []).map((s) => String(s).toLowerCase());
    const hasAnalyticsConsent = consentScopes.includes('analytics');
    if (!matchedSessionId || !hasAnalyticsConsent) {
      return new NextResponse(null, { status: 204, headers: CONSENT_MISSING_HEADERS });
    }

    if (getRefactorFlags().consent_provenance_shadow_enabled) {
      const outcome = evaluateConsentProvenanceShadow({
        payloadClaimsAnalytics: true,
        session: {
          consent_scopes: consentScopes,
          consent_at: matchResult.consentAt,
          consent_provenance: matchResult.consentProvenance,
        },
      });
      applyConsentProvenanceShadowMetrics(outcome);
    }

    const scoreBreakdown = matchResult.scoreBreakdown;
    const callStatus = matchResult.callStatus;

    const rawIntentTarget =
      typeof body.intent_target === 'string' && body.intent_target.trim() !== ''
        ? body.intent_target.trim()
        : (phone_number ?? 'Unknown');
    const inferredAction = inferIntentAction(rawIntentTarget || phone_number || '');
    const explicitIntentAction =
      typeof body.intent_action === 'string' && body.intent_action.trim() !== ''
        ? (body.intent_action.trim().toLowerCase() === 'whatsapp' ? 'whatsapp' : 'phone')
        : null;
    const intent_target = normalizePhoneTarget(rawIntentTarget);
    const intent_action =
      intent_target.toLowerCase().startsWith('whatsapp:')
        ? 'whatsapp'
        : (explicitIntentAction ?? inferredAction);
    const intent_stamp =
      typeof body.intent_stamp === 'string' && body.intent_stamp.trim() !== ''
        ? body.intent_stamp.trim()
        : makeIntentStamp(intent_action === 'whatsapp' ? 'wa' : 'tel', intent_target);
    const intent_page_url =
      typeof body.intent_page_url === 'string' && body.intent_page_url.trim() !== '' ? body.intent_page_url.trim() : (req.headers.get('referer') || null);
    const click_id = typeof body.click_id === 'string' && body.click_id.trim() !== '' ? body.click_id.trim() : null;

    if (SESSION_REUSE_HARDENING_ENABLED && matchedSessionId) {
      const primaryClickId =
        sanitizeClickId(body.gclid || null) ??
        sanitizeClickId(body.wbraid || null) ??
        sanitizeClickId(body.gbraid || null) ??
        null;
      if (primaryClickId && intent_target && ['phone', 'whatsapp', 'form'].includes(intent_action)) {
        const { data: reuseRows, error: reuseErr } = await adminClient.rpc('find_or_reuse_session_v1', {
          p_site_id: siteUuidFinal,
          p_primary_click_id: primaryClickId,
          p_intent_action: intent_action,
          p_normalized_intent_target: intent_target,
          p_occurred_at: matchedAt,
          p_candidate_session_id: matchedSessionId,
          p_proposed_session_id: null,
          p_fingerprint: fingerprint,
          p_entry_page: intent_page_url,
          p_ip_address: null,
          p_user_agent: body.ua || req.headers.get('user-agent'),
          p_gclid: sanitizeClickId(body.gclid || null),
          p_wbraid: sanitizeClickId(body.wbraid || null),
          p_gbraid: sanitizeClickId(body.gbraid || null),
          p_attribution_source: null,
          p_traffic_source: null,
          p_traffic_medium: null,
          p_device_type: null,
          p_device_os: null,
        });
        if (!reuseErr && Array.isArray(reuseRows) && reuseRows.length > 0) {
          const row = reuseRows[0] as {
            matched_session_id?: string | null;
            matched_session_month?: string | null;
            time_delta_ms?: number | null;
            lifecycle_status?: string | null;
            candidate_session_id?: string | null;
          };
          const decision = shouldReuseSessionV1({
            siteMatches: true,
            primaryClickId,
            primaryClickIdValid: true,
            intentAction: intent_action,
            candidateIntentAction: intent_action,
            normalizedIntentTarget: intent_target,
            candidateIntentTarget: intent_target,
            timeDeltaMs: row.time_delta_ms ?? null,
            lifecycleStatus: row.lifecycle_status ?? null,
            candidateSessionId: row.candidate_session_id ?? row.matched_session_id ?? null,
          });
          logWarn('session_reuse_decision_v2', {
            reuse_hit: decision.reuse,
            reuse_miss_reason: decision.reason,
            site_id: siteUuidFinal,
            primary_click_id_present: decision.telemetry.primary_click_id_present,
            intent_action: decision.telemetry.intent_action,
            normalized_intent_target_hash: hashTarget(intent_target),
            candidate_session_id: decision.telemetry.candidate_session_id,
            matched_session_id: row.matched_session_id ?? matchedSessionId,
            time_delta_ms: decision.telemetry.time_delta_ms,
            lifecycle_status: decision.telemetry.lifecycle_status,
            source_path: 'call-event-v2',
          });
          if (row.matched_session_id) {
            matchedSessionId = row.matched_session_id;
            matchedSessionMonth = row.matched_session_month ?? matchedSessionMonth;
          }
        } else if (reuseErr) {
          logWarn('session_reuse_rpc_failed_v2', {
            site_id: siteUuidFinal,
            error: reuseErr.message,
            source_path: 'call-event-v2',
          });
        }
      }
    }

    // DB idempotency: signature_hash = sha256(signature). UNIQUE(site_id, signature_hash) prevents duplicate when Redis replay cache is down.
    const signatureHash = headerSig
      ? createHash('sha256').update(headerSig, 'utf8').digest('hex')
      : null;

    const ceInferenceSuffix =
      event_id ?? signatureHash ?? `h:${createHash('sha256').update(fingerprint, 'utf8').digest('hex').slice(0, 16)}`;
    await recordInferenceRunBestEffort({
      siteId: siteUuidFinal,
      inferenceKind: 'CALL_EVENT_SESSION_MATCH_V1',
      policyVersion: 'match_session:v1_score_v1_1',
      inputDigest: digestCallEventMatchInputs({
        siteId: siteUuidFinal,
        fingerprintLength: fingerprint.length,
        hasPayloadClickIds: Boolean(
          (body.gclid && String(body.gclid).trim()) ||
          (body.wbraid && String(body.wbraid).trim()) ||
          (body.gbraid && String(body.gbraid).trim())
        ),
      }),
      outputSummary: {
        matched_session_id: matchedSessionId,
        lead_score: leadScore,
        call_status: callStatus,
        confidence_score: matchResult.confidenceScore,
      },
      idempotencyKey: `inf:ce_match:${siteUuidFinal}:${ceInferenceSuffix}`,
      occurredAt: new Date(matchedAt),
      correlationId: requestId ?? null,
      sessionId: matchedSessionId,
      callId: null,
    });

    void appendIdentityGraphEdgeBestEffort({
      siteId: siteUuidFinal,
      edgeKind: 'FINGERPRINT_SESSION_BRIDGE',
      ingestSource: 'CALL_EVENT_V2',
      fingerprint,
      sessionId: matchedSessionId,
      correlationId: requestId ?? null,
      idempotencyKey: `ig:ce:${siteUuidFinal}:${ceInferenceSuffix}`,
      payload: {
        lead_score: leadScore,
        call_status: callStatus,
      },
    });

    const workerPayload = buildCallEventIngestWorkerBody({
      sitePublicId: site.id,
      phone_number,
      matched_session_id: matchedSessionId,
      matched_session_month: matchedSessionMonth ?? null,
      matched_fingerprint: fingerprint,
      lead_score: leadScore,
      lead_score_at_match: matchedSessionId ? leadScore : null,
      score_breakdown: scoreBreakdown,
      confidence_score: matchResult.confidenceScore ?? null,
      matched_at: matchedSessionId ? matchedAt : null,
      status: callStatus,
      intent_action,
      intent_target,
      intent_stamp,
      intent_page_url,
      click_id,
      gclid: body.gclid || null,
      wbraid: body.wbraid || null,
      gbraid: body.gbraid || null,
      signature_hash: signatureHash,
      ua: body.ua || req.headers.get('user-agent'),
      event_id: event_id ?? null,
      client_value: value !== null ? value : null,
      ads_context: body.ads_context ?? null,
    });

    const deduplicationId = `ce-${site.id}-${signatureHash || event_id || intent_stamp}`.replace(/:/g, '-');

    try {
      await publishCallEventIngestWorker({
        variant: 'v2_explicit_ingest_url',
        req,
        body: workerPayload,
        deduplicationId,
      });
    } catch (err) {
      logError('call-event-v2 QStash publish failed', {
        request_id: requestId,
        route: ROUTE,
        site_id,
        error: String((err as Error)?.message ?? err),
      });
      Sentry.captureException(err);
      return NextResponse.json(
        { error: 'Failed to queue call' },
        { status: 500, headers: baseHeaders }
      );
    }

    return NextResponse.json(
      { status: 'queued' },
      {
        status: 202,
        headers: {
          ...baseHeaders,
          'X-RateLimit-Limit': String(CALL_EVENT_RL_LIMIT),
          'X-RateLimit-Remaining': rl.remaining.toString(),
          'X-Ops-Proxy': (req.headers.get('x-ops-proxy') || '').toString().slice(0, 8),
        },
      }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('call-event-v2 unhandled error', { request_id: requestId, route: ROUTE, message: msg });
    Sentry.captureException(e, { tags: { route: ROUTE, request_id: requestId } });
    const origin = req.headers.get('origin');
    const errHeaders: Record<string, string> = { Vary: 'Origin', 'X-OpsMantik-Version': OPSMANTIK_VERSION };
    if (origin) errHeaders['Access-Control-Allow-Origin'] = origin;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: errHeaders });
  }
}

export async function POST(req: NextRequest) {
  const res = await callEventV2Inner(req);
  recordRouteHttpResponse('call_event_v2', res.status);
  return res;
}

