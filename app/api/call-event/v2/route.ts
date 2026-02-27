import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';

import { createHash } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { publishToQStash } from '@/lib/ingest/publish';
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
import { findRecentSessionByFingerprint } from '@/lib/api/call-event/match-session-by-fingerprint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/call-event/v2';
const OPSMANTIK_VERSION = '2.0.0-proxy';

const MAX_BODY_BYTES = 64 * 1024;
function getEventIdMode(): EventIdMode {
  return getEventIdModeFromEnv();
}
const AdsContextSchema = z.object({
  keyword: z.string().max(512).nullable().optional(),
  match_type: z.string().max(8).nullable().optional(),
  device_model: z.string().max(256).nullable().optional(),
  geo_target_id: z.number().int().positive().nullable().optional(),
}).nullable().optional();

// V2 payload is identical to V1 but adds event_id (for upcoming idempotency).
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
    // Google Ads ValueTrack enrichment
    ads_context: AdsContextSchema,
  })
  .strict();

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = getIngestCorsHeaders(origin, { 'X-OpsMantik-Version': OPSMANTIK_VERSION });
  const res = new NextResponse(null, { status: 200, headers });
  if (origin) res.headers.set('Access-Control-Allow-Credentials', 'true');
  return res;
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? undefined;

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

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      logError('call-event-v2 verifier misconfigured (missing supabase env)', { request_id: requestId, route: ROUTE });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: baseHeaders });
    }
    const { createClient } = await import('@supabase/supabase-js');
    const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });

    // COMPLIANCE INVARIANT — Route order (DO NOT change):
    // 1) HMAC verify — MUST run first. Consent before HMAC = signature brute-force risk.
    // 2) Replay check  3) Rate limit  4) Session lookup  5) Analytics consent gate  6) Insert  7) OCI enqueue (seal).
    //
    // Auth boundary: verify signature BEFORE any service-role DB call.
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

      const { data: sigOk, error: sigErr } = await anonClient.rpc('verify_call_event_signature_v1', {
        p_site_public_id: headerSiteId,
        p_ts: tsNum,
        p_raw_body: rawBody,
        p_signature: headerSig,
      });
      if (sigErr || sigOk !== true) {
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

    const { data: resolvedBodySiteId, error: resolveBodyErr } = await anonClient.rpc('resolve_site_identifier_v1', {
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
        const { data: resolvedHeaderSiteId, error: resolveHeaderErr } = await anonClient.rpc('resolve_site_identifier_v1', {
          p_input: headerSiteId,
        });
        if (resolveHeaderErr || !resolvedHeaderSiteId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
        if (resolvedHeaderSiteId !== resolvedSiteUuid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
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

    // Replay cache (stronger than timestamp window). Degraded mode falls back locally on redis errors.
    const replaySiteKey = resolvedSiteUuid ?? legacyPublicId ?? 'unknown';
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
    if (!siteUuid) {
      const { data: s, error: sErr } = await adminClient.from('sites').select('id').eq('public_id', legacyPublicId).single();
      if (sErr || !s?.id) return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: baseHeaders });
      siteUuid = s.id;
    }
    if (!siteUuid) return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: baseHeaders });
    const siteUuidFinal: string = siteUuid;
    site_id = siteUuidFinal;
    const site = { id: siteUuidFinal } as const;

    // Per-site(+proxy host) rate limiting (blast-radius isolation).
    const proxyHostRaw = (req.headers.get('x-ops-proxy-host') || '').trim().toLowerCase();
    const proxyHost = proxyHostRaw && proxyHostRaw.length <= 255 ? proxyHostRaw.replace(/[^a-z0-9.-]/g, '').slice(0, 128) : 'unknown';
    const CALL_EVENT_RL_LIMIT = 150; // per site|proxy|client per minute (burst: multiple clicks + retries)
    const rl = await RateLimitService.checkWithMode(`${siteUuidFinal}|${proxyHost}|${clientId}`, CALL_EVENT_RL_LIMIT, 60 * 1000, {
      mode: 'degraded',
      namespace: 'call-event-v2',
      fallbackMaxRequests: 30,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
        {
          status: 429,
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
      mode: 'degraded',
      namespace: 'call-event-v2',
      fallbackMaxRequests: 10,
    });
    if (!rlFp.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: Math.ceil((rlFp.resetAt - Date.now()) / 1000) },
        {
          status: 429,
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
    // Marketing consent required for OCI enqueue (enforce in enqueueSealConversion, PipelineService, confirm_sale_and_enqueue).
    //
    // Find recent session by fingerprint (site-scoped; indexed: sessions(site_id, id, created_month)).
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const recentMonths = getRecentMonths(2);
    const matchedAt = new Date().toISOString();
    const matchResult = await findRecentSessionByFingerprint(adminClient, {
      siteId: siteUuidFinal,
      fingerprint,
      recentMonths,
      thirtyMinutesAgo,
    });

    const matchedSessionId = matchResult.matchedSessionId;
    const leadScore = matchResult.leadScore;

    // COMPLIANCE: Analytics consent gate. No session OR analytics missing → 204, no insert, no OCI.
    // Side-channel mitigation: 204 response identical for (no session) and (no analytics) — same body, same headers.
    const CONSENT_MISSING_HEADERS = { ...baseHeaders, 'x-opsmantik-consent-missing': 'analytics' } as const;
    const consentScopes = (matchResult.consentScopes ?? []).map((s) => String(s).toLowerCase());
    const hasAnalyticsConsent = consentScopes.includes('analytics');
    if (!matchedSessionId || !hasAnalyticsConsent) {
      return new NextResponse(null, { status: 204, headers: CONSENT_MISSING_HEADERS });
    }
    const scoreBreakdown = matchResult.scoreBreakdown;
    const callStatus = matchResult.callStatus;

    const inferredAction = inferIntentAction(phone_number ?? '');
    const intent_action =
      typeof body.intent_action === 'string' && body.intent_action.trim() !== ''
        ? (body.intent_action.trim().toLowerCase() === 'whatsapp' ? 'whatsapp' : 'phone')
        : inferredAction;
    const intent_target =
      typeof body.intent_target === 'string' && body.intent_target.trim() !== ''
        ? body.intent_target.trim()
        : normalizePhoneTarget(phone_number ?? 'Unknown');
    const intent_stamp =
      typeof body.intent_stamp === 'string' && body.intent_stamp.trim() !== ''
        ? body.intent_stamp.trim()
        : makeIntentStamp(intent_action === 'whatsapp' ? 'wa' : 'tel', intent_target);
    const intent_page_url =
      typeof body.intent_page_url === 'string' && body.intent_page_url.trim() !== '' ? body.intent_page_url.trim() : (req.headers.get('referer') || null);
    const click_id = typeof body.click_id === 'string' && body.click_id.trim() !== '' ? body.click_id.trim() : null;

    // DB idempotency: signature_hash = sha256(signature). UNIQUE(site_id, signature_hash) prevents duplicate when Redis replay cache is down.
    const signatureHash = headerSig
      ? createHash('sha256').update(headerSig, 'utf8').digest('hex')
      : null;

    const workerPayload = {
      _ingest_type: 'call-event' as const,
      site_id: site.id,
      phone_number,
      matched_session_id: matchedSessionId,
      matched_fingerprint: fingerprint,
      lead_score: leadScore,
      lead_score_at_match: matchedSessionId ? leadScore : null,
      score_breakdown: scoreBreakdown,
      confidence_score: matchResult.confidenceScore ?? null,
      matched_at: matchedSessionId ? matchedAt : null,
      status: callStatus,
      source: 'click' as const,
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
      ...(event_id ? { event_id } : {}),
      ...(value !== null ? { _client_value: value } : {}),
      ...(body.ads_context ? { ads_context: body.ads_context } : {}),
    };

    const deduplicationId = `ce-${site.id}-${signatureHash || event_id || intent_stamp}`.replace(/:/g, '-');
    const workerUrl = `${new URL(req.url).origin}/api/workers/ingest`;

    try {
      await publishToQStash({
        url: workerUrl,
        body: workerPayload,
        deduplicationId,
        retries: 3,
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
          'X-RateLimit-Limit': '80',
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

