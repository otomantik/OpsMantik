import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { ReplayCacheService } from '@/lib/services/replay-cache-service';
import { parseAllowedOrigins, isOriginAllowed } from '@/lib/security/cors';
import { SITE_PUBLIC_ID_RE, SITE_UUID_RE, isValidSiteIdentifier } from '@/lib/security/site-identifier';
import { getRecentMonths } from '@/lib/sync-utils';
import { logError, logWarn } from '@/lib/logging/logger';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import {
    getEventIdModeFromEnv,
    inferIntentAction,
    isMissingEventIdColumnError,
    isMissingResolveRpcError,
    isRecord,
    makeIntentStamp,
    normalizePhoneTarget,
    parseValueAllowNull,
    type EventIdMode,
} from '@/lib/api/call-event/shared';
import type { CallInsertError, CallRecord, EventMetadata, ScoreBreakdown } from '@/lib/types/call-event';

// Ensure Node.js runtime (uses process.env + supabase-js).
export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

// Global version for debug verification
const OPSMANTIK_VERSION = '1.0.2-bulletproof';

// Parse allowed origins (fail-closed in production)
const ALLOWED_ORIGINS = parseAllowedOrigins();

const MAX_CALL_EVENT_BODY_BYTES = 64 * 1024; // 64KB

const CallEventSchema = z
    .object({
        // V2 rollout: accept event_id but ignore until DB idempotency migration lands.
        event_id: z.string().uuid().optional(),
        site_id: z.string().min(1).max(64).refine(isValidSiteIdentifier, 'Invalid site_id'),
        fingerprint: z.string().min(1).max(128),
        phone_number: z.string().max(256).nullable().optional(),
        // V2 tracker context (accepted, not required)
        action: z.string().max(32).nullable().optional(),
        url: z.string().max(2048).nullable().optional(),
        ua: z.string().max(512).nullable().optional(),
        value: z.union([z.number(), z.string(), z.null()]).optional(),
        intent_action: z.string().max(32).nullable().optional(),
        intent_target: z.string().max(512).nullable().optional(),
        intent_stamp: z.string().max(128).nullable().optional(),
        intent_page_url: z.string().max(2048).nullable().optional(),
        click_id: z.string().max(256).nullable().optional(),
    })
    .strict();

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get('origin');
    const signingDisabledCors =
        process.env.CALL_EVENT_SIGNING_DISABLED === '1' || process.env.CALL_EVENT_SIGNING_DISABLED === 'true';
    const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);
    const allowAnyOrigin = !signingDisabledCors;

    const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Ops-Site-Id, X-Ops-Ts, X-Ops-Signature',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
        'X-OpsMantik-Version': OPSMANTIK_VERSION,
        'X-CORS-Status': allowAnyOrigin ? 'relaxed' : (isAllowed ? 'allowed' : 'rejected'),
        'X-CORS-Reason': allowAnyOrigin ? 'signed_any_origin' : (reason || 'ok'),
        'X-Ops-Deprecated': '1',
        'X-Ops-Deprecated-Use': CALL_EVENT_V2_ROUTE,
        'Sunset': DEPRECATION_SUNSET,
    };

    // For signed call-event endpoint, allow any origin by reflecting it (still protected by HMAC).
    if ((allowAnyOrigin || isAllowed) && origin) {
        headers['Access-Control-Allow-Origin'] = origin;
    }

    return new NextResponse(null, {
        status: (allowAnyOrigin || isAllowed) ? 200 : 403,
        headers,
    });
}

const CALL_EVENT_ROUTE = '/api/call-event';
const CALL_EVENT_V2_ROUTE = '/api/call-event/v2';
const DEPRECATION_SUNSET = '2026-05-10'; // yyyy-mm-dd (informational; v2 is canonical)
function getEventIdMode(): EventIdMode {
    return getEventIdModeFromEnv();
}

export async function POST(req: NextRequest) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    try {
        // CORS check
        const origin = req.headers.get('origin');
        const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

        // If signing is enabled, CORS allowlist is not required: the HMAC signature is the auth boundary.
        const signingDisabledCors =
            process.env.CALL_EVENT_SIGNING_DISABLED === '1' || process.env.CALL_EVENT_SIGNING_DISABLED === 'true';
        const allowAnyOrigin = !signingDisabledCors;

        const baseHeaders: Record<string, string> = {
            'Vary': 'Origin',
            'X-OpsMantik-Version': OPSMANTIK_VERSION,
            'X-CORS-Status': allowAnyOrigin ? 'relaxed' : (isAllowed ? 'allowed' : 'rejected'),
            'X-CORS-Reason': allowAnyOrigin ? 'signed_any_origin' : (reason || 'ok'),
            'X-Ops-Deprecated': '1',
            'X-Ops-Deprecated-Use': CALL_EVENT_V2_ROUTE,
            'Sunset': DEPRECATION_SUNSET,
        };

        if ((allowAnyOrigin || isAllowed) && origin) {
            baseHeaders['Access-Control-Allow-Origin'] = origin;
        }

        // Only enforce allowlist when unsigned rollback mode is enabled.
        if (!allowAnyOrigin && !isAllowed) {
            return NextResponse.json(
                { error: 'Origin not allowed', reason },
                { status: 403, headers: baseHeaders }
            );
        }

        // Rate limiting: 50 requests per minute per IP (calls are less frequent)
        const clientId = RateLimitService.getClientId(req);
        const rateLimitResult = await RateLimitService.checkWithMode(clientId, 50, 60 * 1000, {
            mode: 'degraded',
            namespace: 'call-event',
            fallbackMaxRequests: 10,
        });

        if (!rateLimitResult.allowed) {
            return NextResponse.json(
                { error: 'Rate limit exceeded', retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000) },
                {
                    status: 429,
                    headers: {
                        ...baseHeaders,
                        'X-RateLimit-Limit': '50',
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': rateLimitResult.resetAt.toString(),
                        'Retry-After': Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000).toString(),
                    },
                }
            );
        }

        // --- 0) Read raw body (for HMAC) + enforce max size ---
        const rawBody = await req.text();
        const rawBytes = Buffer.byteLength(rawBody, 'utf8');
        if (rawBytes > MAX_CALL_EVENT_BODY_BYTES) {
            return NextResponse.json(
                { error: 'Payload too large' },
                { status: 413, headers: baseHeaders }
            );
        }

        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !anonKey) {
            logError('call-event verifier misconfigured (missing supabase env)', { request_id: requestId, route: CALL_EVENT_ROUTE });
            return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: baseHeaders });
        }
        const { createClient } = await import('@supabase/supabase-js');
        const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });

        // COMPLIANCE: Route order — HMAC → Replay → Rate limit → Session lookup → Consent gate → Insert. Consent before HMAC = brute-force risk.
        // --- 1) Auth boundary: verify signature BEFORE any service-role DB call ---
        // Rollback switch: set CALL_EVENT_SIGNING_DISABLED=1 to temporarily accept unsigned calls.
        const signingDisabled =
            process.env.CALL_EVENT_SIGNING_DISABLED === '1' || process.env.CALL_EVENT_SIGNING_DISABLED === 'true';

        let headerSiteId = '';
        let headerSig = '';
        if (!signingDisabled) {
            headerSiteId = (req.headers.get('x-ops-site-id') || '').trim();
            const headerTs = (req.headers.get('x-ops-ts') || '').trim();
            headerSig = (req.headers.get('x-ops-signature') || '').trim();

            // Fast validation (fail-closed)
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

            // Verify signature via DB (boolean only; secrets never leave DB).
            const { data: sigOk, error: sigErr } = await anonClient.rpc('verify_call_event_signature_v1', {
                p_site_public_id: headerSiteId,
                p_ts: tsNum,
                p_raw_body: rawBody,
                p_signature: headerSig,
            });
            if (sigErr || sigOk !== true) {
                logWarn('call-event signature rejected', {
                    request_id: requestId,
                    route: CALL_EVENT_ROUTE,
                    site_id: headerSiteId,
                    error: sigErr?.message,
                });
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
            }
        } else {
            logWarn('call-event signing disabled (rollback mode)', { request_id: requestId, route: CALL_EVENT_ROUTE });
        }

        let bodyJson: unknown;
        try {
            bodyJson = rawBody ? JSON.parse(rawBody) : {};
        } catch (e) {
            logWarn('call-event invalid json body', {
                request_id: requestId,
                route: CALL_EVENT_ROUTE,
                error: String((e as Error)?.message ?? e),
            });
            return NextResponse.json(
                { error: 'Invalid JSON' },
                { status: 400, headers: baseHeaders }
            );
        }

        if (!isRecord(bodyJson)) {
            return NextResponse.json(
                { error: 'Invalid body' },
                { status: 400, headers: baseHeaders }
            );
        }
        // COMPLIANCE: Reject consent escalation — call-event must NOT accept or modify consent.
        if ('consent_scopes' in bodyJson || 'consent_at' in bodyJson) {
            return NextResponse.json(
                { error: 'Invalid body', hint: 'consent_scopes and consent_at are not allowed' },
                { status: 400, headers: baseHeaders }
            );
        }

        const parsed = CallEventSchema.safeParse(bodyJson);
        if (!parsed.success) {
            const first = parsed.error.issues[0];
            const hint = first?.path?.length ? `${first.path.join('.')}: ${first.message}` : first?.message ?? 'Invalid body';
            logWarn('call-event validation failed', {
                request_id: requestId,
                route: CALL_EVENT_ROUTE,
                hint,
                code: first?.code,
            });
            return NextResponse.json(
                { error: 'Invalid body', hint },
                { status: 400, headers: baseHeaders }
            );
        }

        const body = parsed.data;
        // Resolve site identifier BEFORE service-role DB access (UUID or public_id -> canonical UUID).
        // Back-compat: if the resolver RPC isn't deployed yet, fall back to legacy public_id-only flow.
        let resolvedSiteUuid: string | null = null;
        let legacyPublicId: string | null = null;

        const { data: resolvedBodySiteId, error: resolveBodyErr } = await anonClient.rpc('resolve_site_identifier_v1', {
            p_input: body.site_id,
        });
        if (resolveBodyErr) {
            if (!isMissingResolveRpcError(resolveBodyErr)) {
                logError('call-event resolve_site_identifier_v1 failed', {
                    request_id: requestId,
                    route: CALL_EVENT_ROUTE,
                    message: resolveBodyErr.message,
                });
                return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: baseHeaders });
            }
            if (!SITE_PUBLIC_ID_RE.test(body.site_id)) {
                return NextResponse.json({ error: 'Invalid site_id' }, { status: 400, headers: baseHeaders });
            }
            legacyPublicId = body.site_id;
        } else {
            if (!resolvedBodySiteId) {
                return NextResponse.json({ error: 'Invalid site_id' }, { status: 400, headers: baseHeaders });
            }
            resolvedSiteUuid = resolvedBodySiteId;
        }

        // Enforce header/body binding when signing is enabled (prevents cross-site signature reuse).
        if (!signingDisabled) {
            if (legacyPublicId) {
                if (!SITE_PUBLIC_ID_RE.test(headerSiteId) || headerSiteId !== legacyPublicId) {
                    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
                }
            } else {
                const { data: resolvedHeaderSiteId, error: resolveHeaderErr } = await anonClient.rpc('resolve_site_identifier_v1', {
                    p_input: headerSiteId,
                });
                if (resolveHeaderErr || !resolvedHeaderSiteId) {
                    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
                }
                if (resolvedHeaderSiteId !== resolvedSiteUuid) {
                    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
                }
            }
        }

        // site_id is canonical UUID when resolver exists; otherwise derived later in legacy mode.
        let site_id: string | null = resolvedSiteUuid;
        const fingerprint = body.fingerprint;
        const phone_number = (typeof body.phone_number === 'string' ? body.phone_number : null) ?? null;
        const eventIdMode = getEventIdMode();
        const event_id = eventIdMode !== 'off' ? (body.event_id ?? null) : null;
        let eventIdColumnOk = eventIdMode === 'on';
        // Accept value=null/undefined without failing.
        const value = parseValueAllowNull(body.value);

        if (!fingerprint) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400, headers: baseHeaders }
            );
        }

        // Replay cache (stronger than timestamp window). Degraded mode falls back locally on redis errors.
        const replaySiteKey = resolvedSiteUuid ?? legacyPublicId ?? 'unknown';
        const replayKey = ReplayCacheService.makeReplayKey({ siteId: replaySiteKey, eventId: event_id, signature: headerSig || null });
        const replay = await ReplayCacheService.checkAndStore(replayKey, 10 * 60 * 1000, { mode: 'degraded', namespace: 'call-event' });
        if (replay.isReplay) {
            // Best-effort: if event_id is present, return existing call id to help client-side correlation.
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
                        { headers: baseHeaders }
                    );
                }
            }
            return NextResponse.json({ status: 'noop' }, { status: 200, headers: baseHeaders });
        }

        // Canonical site UUID for DB operations.
        let siteUuid = resolvedSiteUuid;
        if (!siteUuid) {
            const { data: s, error: sErr } = await adminClient
                .from('sites')
                .select('id')
                .eq('public_id', legacyPublicId)
                .single();
            if (sErr || !s?.id) {
                logWarn('call-event site not found (legacy public_id)', { request_id: requestId, route: CALL_EVENT_ROUTE, site_id: legacyPublicId ?? undefined });
                return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: baseHeaders });
            }
            siteUuid = s.id;
        }
        // TS: ensure non-null canonical UUID from here.
        if (!siteUuid) {
            return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: baseHeaders });
        }
        const siteUuidFinal: string = siteUuid;

        const site = { id: siteUuidFinal } as const;
        // Ensure downstream logs/queries use canonical UUID.
        site_id = siteUuidFinal;

        // Per-site rate limiting (blast-radius isolation).
        const siteRateLimit = await RateLimitService.checkWithMode(`${siteUuidFinal}|${clientId}`, 80, 60 * 1000, {
            mode: 'degraded',
            namespace: 'call-event-site',
            fallbackMaxRequests: 15,
        });
        if (!siteRateLimit.allowed) {
            return NextResponse.json(
                { error: 'Rate limit exceeded', retryAfter: Math.ceil((siteRateLimit.resetAt - Date.now()) / 1000) },
                {
                    status: 429,
                    headers: {
                        ...baseHeaders,
                        'X-RateLimit-Limit': '80',
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': siteRateLimit.resetAt.toString(),
                        'Retry-After': Math.ceil((siteRateLimit.resetAt - Date.now()) / 1000).toString(),
                    },
                }
            );
        }
        // Per-fingerprint rate limit (brute-force session probing guard)
        const rlFp = await RateLimitService.checkWithMode(`fp:${siteUuidFinal}:${fingerprint}`, 20, 60 * 1000, {
            mode: 'degraded',
            namespace: 'call-event',
            fallbackMaxRequests: 10,
        });
        if (!rlFp.allowed) {
            return NextResponse.json(
                { error: 'Rate limit exceeded', retryAfter: Math.ceil((rlFp.resetAt - Date.now()) / 1000) },
                { status: 429, headers: { ...baseHeaders, 'Retry-After': Math.ceil((rlFp.resetAt - Date.now()) / 1000).toString() } }
            );
        }

        // COMPLIANCE INVARIANT: No call insert without session analytics consent. Marketing consent required for OCI enqueue.
        // 2. Find most recent session for this fingerprint (within last 30 minutes)
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const recentMonths = getRecentMonths(2);

        const { data: recentEvents, error: eventsError } = await adminClient
            .from('events')
            .select('session_id, session_month, metadata, created_at')
            .eq('metadata->>fingerprint', fingerprint)
            .in('session_month', recentMonths)
            .gte('created_at', thirtyMinutesAgo)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(1);

        if (eventsError) {
            logError('call-event events query error', {
                request_id: requestId,
                route: CALL_EVENT_ROUTE,
                site_id: site_id ?? undefined,
                fingerprint,
                code: eventsError.code,
                details: eventsError.details,
                message: eventsError.message,
            });

            return NextResponse.json(
                { error: 'Failed to query events', details: eventsError.message },
                { status: 500, headers: baseHeaders }
            );
        }

        let matchedSessionId: string | null = null;
        let leadScore = 0;
        let scoreBreakdown: ScoreBreakdown | null = null;
        let callStatus: string | null = null;
        let sessionConsentScopes: string[] = [];
        const matchedAt = new Date().toISOString();

        if (recentEvents && recentEvents.length > 0) {
            matchedSessionId = recentEvents[0].session_id;
            const sessionMonth = recentEvents[0].session_month;

            // Validate: Check session exists and was created before match. Include consent_scopes for analytics gate.
            const { data: session, error: sessionError } = await adminClient
                .from('sessions')
                .select('id, created_at, created_month, consent_scopes')
                .eq('id', matchedSessionId)
                .eq('site_id', siteUuidFinal)
                .eq('created_month', sessionMonth)
                .single();

            if (sessionError || !session) {
                // Session doesn't exist - invalid match
                logWarn('call-event session not found for match', {
                    request_id: requestId,
                    route: CALL_EVENT_ROUTE,
                    site_id: site_id ?? undefined,
                    session_id: matchedSessionId,
                    error: sessionError?.message,
                });
                matchedSessionId = null;
            } else {
                sessionConsentScopes = ((session as { consent_scopes?: string[] }).consent_scopes ?? []).map((s) => String(s).toLowerCase());
                // Check if match is suspicious (session created after match by > 2 minutes)
                const sessionCreatedAt = new Date(session.created_at);
                const matchTime = new Date(matchedAt);
                const timeDiffMinutes = (sessionCreatedAt.getTime() - matchTime.getTime()) / (1000 * 60);

                if (timeDiffMinutes > 2) {
                    // Suspicious: session created more than 2 minutes after match
                    logWarn('call-event suspicious match detected', {
                        request_id: requestId,
                        route: CALL_EVENT_ROUTE,
                        site_id: site_id ?? undefined,
                        session_id: matchedSessionId,
                        session_created_at: session.created_at,
                        matched_at: matchedAt,
                        time_diff_minutes: timeDiffMinutes.toFixed(2),
                    });
                    callStatus = 'suspicious';
                } else {
                    callStatus = 'intent'; // Normal match
                }

                // 3. Calculate lead score from session events (only if match is valid)
                const { data: sessionEvents, error: sessionEventsError } = await adminClient
                    .from('events')
                    .select('event_category, event_action, metadata')
                    .eq('session_id', matchedSessionId)
                    .eq('session_month', sessionMonth);

                if (sessionEventsError) {
                    logError('call-event session events query error', {
                        request_id: requestId,
                        route: CALL_EVENT_ROUTE,
                        site_id: site_id ?? undefined,
                        session_id: matchedSessionId,
                        code: sessionEventsError.code,
                        message: sessionEventsError.message,
                    });

                    return NextResponse.json(
                        { error: 'Failed to query session events', details: sessionEventsError.message },
                        { status: 500, headers: baseHeaders }
                    );
                }

                if (sessionEvents && sessionEvents.length > 0) {
                    const conversionCount = sessionEvents.filter(e => e.event_category === 'conversion').length;
                    const interactionCount = sessionEvents.filter(e => e.event_category === 'interaction').length;
                    const scores = sessionEvents.map(e => Number((e.metadata as EventMetadata | null)?.lead_score) || 0);
                    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

                    const conversionPoints = conversionCount * 20;
                    const interactionPoints = interactionCount * 5;
                    const bonuses = maxScore;
                    const rawScore = conversionPoints + interactionPoints + bonuses;
                    const cappedAt100 = rawScore > 100;

                    leadScore = Math.min(rawScore, 100);
                    scoreBreakdown = {
                        conversionPoints,
                        interactionPoints,
                        bonuses,
                        cappedAt100,
                        rawScore,
                        finalScore: leadScore
                    };
                }
            }
        }

        // COMPLIANCE: Analytics consent gate. No session OR analytics missing → 204, no insert.
        // Side-channel mitigation: 204 identical for (no session) and (no analytics).
        const consentMissingHeaders = { ...baseHeaders, 'x-opsmantik-consent-missing': 'analytics' } as const;
        if (!matchedSessionId || !sessionConsentScopes.includes('analytics')) {
            return new NextResponse(null, { status: 204, headers: consentMissingHeaders });
        }

        // Derive intent fields required by DB invariants for click-sourced calls.
        // IMPORTANT: DB has a CHECK constraint:
        //   source <> 'click' OR (intent_action in ('phone','whatsapp') AND intent_target AND intent_stamp).
        // We explicitly set these to avoid insert failures.
        const inferredAction = inferIntentAction(phone_number ?? '');
        const intent_action = (typeof body.intent_action === 'string' && body.intent_action.trim() !== '')
            ? (body.intent_action.trim().toLowerCase() === 'whatsapp' ? 'whatsapp' : 'phone')
            : inferredAction;
        const intent_target = (typeof body.intent_target === 'string' && body.intent_target.trim() !== '')
            ? body.intent_target.trim()
            : normalizePhoneTarget(phone_number ?? 'Unknown');
        const intent_stamp = (typeof body.intent_stamp === 'string' && body.intent_stamp.trim() !== '')
            ? body.intent_stamp.trim()
            : makeIntentStamp(intent_action === 'whatsapp' ? 'wa' : 'tel', intent_target);
        const intent_page_url = typeof body.intent_page_url === 'string' && body.intent_page_url.trim() !== ''
            ? body.intent_page_url.trim()
            : (req.headers.get('referer') || null);
        const click_id = typeof body.click_id === 'string' && body.click_id.trim() !== ''
            ? body.click_id.trim()
            : null;

        // 4. Insert call record
        // DB idempotency: signature_hash = sha256(signature). UNIQUE(site_id, signature_hash) prevents duplicate when Redis replay cache is down.
        const signatureHash = headerSig
            ? createHash('sha256').update(headerSig, 'utf8').digest('hex')
            : null;

        const baseInsert: Record<string, unknown> = {
            site_id: site.id,
            phone_number,
            matched_session_id: matchedSessionId,
            matched_fingerprint: fingerprint,
            lead_score: leadScore,
            lead_score_at_match: matchedSessionId ? leadScore : null,
            score_breakdown: scoreBreakdown,
            matched_at: matchedSessionId ? matchedAt : null,
            status: callStatus, // 'intent', 'suspicious', or null
            source: 'click',
            intent_action,
            intent_target,
            intent_stamp,
            intent_page_url,
            click_id,
            ...(value !== null ? { _client_value: value } : {}),
            ...(signatureHash ? { signature_hash: signatureHash } : {}),
        };

        const insertWithEventId = {
            ...baseInsert,
            ...(event_id ? { event_id } : {}),
        };

        let callRecord: CallRecord | null = null;
        let insertError: CallInsertError = null;
        if (eventIdMode !== 'off' && event_id) {
            const r1 = await adminClient.from('calls').insert(insertWithEventId).select().single();
            callRecord = r1.data;
            insertError = r1.error;
            if (insertError && isMissingEventIdColumnError(insertError)) {
                // DB migration not yet applied in this environment. Retry without event_id.
                eventIdColumnOk = false;
                logWarn('call-event: calls.event_id missing; retrying insert without event_id', {
                    request_id: requestId,
                    route: CALL_EVENT_ROUTE,
                    site_id: site.id,
                });
                const r2 = await adminClient.from('calls').insert(baseInsert).select().single();
                callRecord = r2.data;
                insertError = r2.error;
            }
        } else {
            const r0 = await adminClient.from('calls').insert(baseInsert).select().single();
            callRecord = r0.data;
            insertError = r0.error;
        }

        if (insertError) {
            // Idempotency: treat unique conflicts as NOOP and return existing call.
            if (insertError.code === '23505') {
                let existing: { id: string; matched_session_id?: string | null; lead_score?: number | null } | null = null;
                if (signatureHash) {
                    const { data: bySig } = await adminClient
                        .from('calls')
                        .select('id, matched_session_id, lead_score')
                        .eq('site_id', site.id)
                        .eq('signature_hash', signatureHash)
                        .single();
                    existing = bySig;
                }
                if (!existing && event_id && eventIdColumnOk) {
                    const { data: byEventId } = await adminClient
                        .from('calls')
                        .select('id, matched_session_id, lead_score')
                        .eq('site_id', site.id)
                        .eq('event_id', event_id)
                        .single();
                    existing = byEventId;
                }
                if (!existing) {
                    const { data: byIntent } = await adminClient
                        .from('calls')
                        .select('id, matched_session_id, lead_score')
                        .eq('site_id', site.id)
                        .eq('intent_stamp', intent_stamp)
                        .single();
                    existing = byIntent;
                }

                if (existing) {
                    return NextResponse.json(
                        signatureHash
                            ? { status: 'noop', reason: 'idempotent_conflict', call_id: existing.id, session_id: existing.matched_session_id ?? null, lead_score: typeof existing.lead_score === 'number' ? existing.lead_score : leadScore }
                            : { status: 'noop', call_id: existing.id, session_id: existing.matched_session_id ?? null, lead_score: typeof existing.lead_score === 'number' ? existing.lead_score : leadScore },
                        {
                            headers: {
                                ...baseHeaders,
                                'X-RateLimit-Limit': '50',
                                'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
                            },
                        }
                    );
                }
            }

            logError('call-event insert failed', {
                request_id: requestId,
                route: CALL_EVENT_ROUTE,
                site_id,
                code: insertError.code,
                details: insertError.details,
                hint: insertError.hint,
                message: insertError.message,
            });
            return NextResponse.json(
                { error: 'Failed to record call' },
                { status: 500, headers: baseHeaders }
            );
        }

        return NextResponse.json(
            {
                status: 'matched',
                call_id: callRecord!.id,
                session_id: matchedSessionId,
                lead_score: leadScore,
            },
            {
                headers: {
                    ...baseHeaders,
                    'X-RateLimit-Limit': '50',
                    'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
                },
            }
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(errorMessage, { request_id: requestId, route: CALL_EVENT_ROUTE });
        Sentry.captureException(error, { tags: { request_id: requestId, route: CALL_EVENT_ROUTE } });

        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500, headers: { 'Vary': 'Origin' } }
        );
    }
}
