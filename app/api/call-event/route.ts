import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { publishToQStash } from '@/lib/ingest/publish';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { ReplayCacheService } from '@/lib/services/replay-cache-service';
import { getIngestCorsHeaders } from '@/lib/security/cors';
import { SITE_PUBLIC_ID_RE, SITE_UUID_RE, isValidSiteIdentifier } from '@/lib/security/site-identifier';
import { getRecentMonths } from '@/lib/sync-utils';
import { logError, logWarn } from '@/lib/logging/logger';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
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
import type { ScoreBreakdown } from '@/lib/types/call-event';

// Ensure Node.js runtime (uses process.env + supabase-js).
export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

// Global version for debug verification
const OPSMANTIK_VERSION = '1.0.2-bulletproof';

const MAX_CALL_EVENT_BODY_BYTES = 64 * 1024; // 64KB

const AdsContextSchema = z.object({
    keyword: z.string().max(512).nullable().optional(),
    match_type: z.string().max(8).nullable().optional(),
    device_model: z.string().max(256).nullable().optional(),
    geo_target_id: z.number().int().positive().nullable().optional(),
}).nullable().optional();

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
        // Google Ads ValueTrack enrichment
        ads_context: AdsContextSchema,
    })
    .strict();

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get('origin');
    const headers = getIngestCorsHeaders(origin, {
        'X-OpsMantik-Version': OPSMANTIK_VERSION,
        'X-Ops-Deprecated': '1',
        'X-Ops-Deprecated-Use': CALL_EVENT_V2_ROUTE,
        Sunset: DEPRECATION_SUNSET,
    });
    const res = new NextResponse(null, { status: 200, headers });
    if (origin) res.headers.set('Access-Control-Allow-Credentials', 'true');
    return res;
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
        const origin = req.headers.get('origin');
        const baseHeaders: Record<string, string> = {
            ...getIngestCorsHeaders(origin, {
                'X-OpsMantik-Version': OPSMANTIK_VERSION,
                'X-Ops-Deprecated': '1',
                'X-Ops-Deprecated-Use': CALL_EVENT_V2_ROUTE,
                Sunset: DEPRECATION_SUNSET,
            }),
        };

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
        // 2. Find most recent session and compute V1.1 score (shared with v2)
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const recentMonths = getRecentMonths(2);
        const matchResult = await findRecentSessionByFingerprint(adminClient, {
            siteId: siteUuidFinal,
            fingerprint,
            recentMonths,
            thirtyMinutesAgo,
        });

        const matchedAt = new Date().toISOString();
        const matchedSessionId = matchResult.matchedSessionId;
        const leadScore = matchResult.leadScore;
        const scoreBreakdown = matchResult.scoreBreakdown as ScoreBreakdown | null;
        const callStatus = matchResult.callStatus;
        const sessionConsentScopes = (matchResult.consentScopes ?? []).map((s) => String(s).toLowerCase());

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

        // 4. Publish to QStash worker → 202 Accepted
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
            signature_hash: signatureHash,
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
            logError('call-event QStash publish failed', {
                request_id: requestId,
                route: CALL_EVENT_ROUTE,
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
