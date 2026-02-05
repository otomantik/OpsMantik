import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { RateLimitService } from '@/lib/services/RateLimitService';
import { parseAllowedOrigins, isOriginAllowed } from '@/lib/cors';
import { getRecentMonths } from '@/lib/sync-utils';
import { logError, logWarn } from '@/lib/log';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

// Ensure Node.js runtime (uses process.env + supabase-js).
export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

// Global version for debug verification
const OPSMANTIK_VERSION = '1.0.2-bulletproof';

// Parse allowed origins (fail-closed in production)
const ALLOWED_ORIGINS = parseAllowedOrigins();

const MAX_CALL_EVENT_BODY_BYTES = 64 * 1024; // 64KB

// Site identifier can be UUID or 32-hex public id.
const SITE_PUBLIC_ID_RE = /^[a-f0-9]{32}$/i;
const SITE_UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CallEventSchema = z
    .object({
        // V2 rollout: accept event_id but ignore until DB idempotency migration lands.
        event_id: z.string().uuid().optional(),
        site_id: z.string().min(1).max(64).refine(
            (s) => SITE_PUBLIC_ID_RE.test(s) || SITE_UUID_RE.test(s),
            'Invalid site_id'
        ),
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

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizePhoneTarget(raw: string): string {
    // Keep a stable normalized target for dedupe. Do not over-normalize WhatsApp URLs.
    const t = raw.trim();
    if (t.toLowerCase().startsWith('tel:')) {
        return t.slice(4).replace(/[^\d+]/g, '');
    }
    // For plain numbers, normalize to digits/+ only.
    if (/^\+?\d[\d\s().-]{6,}$/.test(t)) {
        return t.replace(/[^\d+]/g, '');
    }
    return t;
}

function inferIntentAction(phoneOrHref: string): 'phone' | 'whatsapp' {
    const v = phoneOrHref.toLowerCase();
    if (v.includes('wa.me') || v.includes('whatsapp.com')) return 'whatsapp';
    if (v.startsWith('tel:')) return 'phone';
    // Fallback: treat numeric-ish as phone
    return 'phone';
}

function rand4(): string {
    return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

function hash6(str: string): string {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
    }
    const out = Math.abs(h).toString(36);
    return out.slice(0, 6).padEnd(6, '0');
}

function makeIntentStamp(actionShort: string, target: string): string {
    const ts = Date.now();
    const tHash = hash6((target || '').toLowerCase());
    return `${ts}-${rand4()}-${actionShort}-${tHash}`;
}

function parseValueAllowNull(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get('origin');
    const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

    const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Ops-Site-Id, X-Ops-Ts, X-Ops-Signature',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
        'X-OpsMantik-Version': OPSMANTIK_VERSION,
        'X-CORS-Status': isAllowed ? 'allowed' : 'rejected',
        'X-CORS-Reason': reason || 'ok',
    };

    if (isAllowed && origin) {
        headers['Access-Control-Allow-Origin'] = origin;
    }

    return new NextResponse(null, {
        status: isAllowed ? 200 : 403,
        headers,
    });
}

const CALL_EVENT_ROUTE = '/api/call-event';

export async function POST(req: NextRequest) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    try {
        // CORS check
        const origin = req.headers.get('origin');
        const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

        const baseHeaders: Record<string, string> = {
            'Vary': 'Origin',
            'X-OpsMantik-Version': OPSMANTIK_VERSION,
            'X-CORS-Status': isAllowed ? 'allowed' : 'rejected',
            'X-CORS-Reason': reason || 'ok',
        };

        if (isAllowed && origin) {
            baseHeaders['Access-Control-Allow-Origin'] = origin;
        }

        if (!isAllowed) {
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

        // --- 1) Auth boundary: verify signature BEFORE any service-role DB call ---
        // Rollback switch: set CALL_EVENT_SIGNING_DISABLED=1 to temporarily accept unsigned calls.
        const signingDisabled =
            process.env.CALL_EVENT_SIGNING_DISABLED === '1' || process.env.CALL_EVENT_SIGNING_DISABLED === 'true';

        let headerSiteId = '';
        if (!signingDisabled) {
            headerSiteId = (req.headers.get('x-ops-site-id') || '').trim();
            const headerTs = (req.headers.get('x-ops-ts') || '').trim();
            const headerSig = (req.headers.get('x-ops-signature') || '').trim();

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

        const parsed = CallEventSchema.safeParse(bodyJson);
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid body' },
                { status: 400, headers: baseHeaders }
            );
        }

        const body = parsed.data;
        // Resolve site identifier BEFORE service-role DB access (UUID or public_id -> canonical UUID).
        const { data: resolvedBodySiteId, error: resolveBodyErr } = await anonClient.rpc('resolve_site_identifier_v1', {
            p_input: body.site_id,
        });
        if (resolveBodyErr) {
            logError('call-event resolve_site_identifier_v1 failed', {
                request_id: requestId,
                route: CALL_EVENT_ROUTE,
                message: resolveBodyErr.message,
            });
            return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: baseHeaders });
        }
        if (!resolvedBodySiteId) {
            return NextResponse.json({ error: 'Invalid site_id' }, { status: 400, headers: baseHeaders });
        }

        // Enforce header/body binding when signing is enabled (prevents cross-site signature reuse).
        if (!signingDisabled) {
            const { data: resolvedHeaderSiteId, error: resolveHeaderErr } = await anonClient.rpc('resolve_site_identifier_v1', {
                p_input: headerSiteId,
            });
            if (resolveHeaderErr || !resolvedHeaderSiteId) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
            }
            if (resolvedHeaderSiteId !== resolvedBodySiteId) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
            }
        }

        const site_id = resolvedBodySiteId;
        const fingerprint = body.fingerprint;
        const phone_number = (typeof body.phone_number === 'string' ? body.phone_number : null) ?? null;
        // Accept value=null/undefined without failing.
        const value = parseValueAllowNull(body.value);

        if (!site_id || !fingerprint) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400, headers: baseHeaders }
            );
        }

        // 1. Validate Site
        const { data: site, error: siteError } = await adminClient
            .from('sites')
            .select('id')
            .eq('id', site_id)
            .single();

        if (siteError || !site) {
            logWarn('call-event site not found', { request_id: requestId, route: CALL_EVENT_ROUTE, site_id });
            return NextResponse.json(
                { error: 'Site not found' },
                { status: 404, headers: baseHeaders }
            );
        }

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
                site_id,
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
        let scoreBreakdown: any = null;
        let callStatus: string | null = null;
        const matchedAt = new Date().toISOString();

        if (recentEvents && recentEvents.length > 0) {
            matchedSessionId = recentEvents[0].session_id;
            const sessionMonth = recentEvents[0].session_month;

            // Validate: Check session exists and was created before match
            const { data: session, error: sessionError } = await adminClient
                .from('sessions')
                .select('id, created_at, created_month')
                .eq('id', matchedSessionId)
                .eq('created_month', sessionMonth)
                .single();

            if (sessionError || !session) {
                // Session doesn't exist - invalid match
                logWarn('call-event session not found for match', {
                    request_id: requestId,
                    route: CALL_EVENT_ROUTE,
                    site_id,
                    session_id: matchedSessionId,
                    error: sessionError?.message,
                });
                matchedSessionId = null;
            } else {
                // Check if match is suspicious (session created after match by > 2 minutes)
                const sessionCreatedAt = new Date(session.created_at);
                const matchTime = new Date(matchedAt);
                const timeDiffMinutes = (sessionCreatedAt.getTime() - matchTime.getTime()) / (1000 * 60);

                if (timeDiffMinutes > 2) {
                    // Suspicious: session created more than 2 minutes after match
                    logWarn('call-event suspicious match detected', {
                        request_id: requestId,
                        route: CALL_EVENT_ROUTE,
                        site_id,
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
                        site_id,
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
                    const scores = sessionEvents.map(e => Number((e.metadata as any)?.lead_score) || 0);
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
        const { data: callRecord, error: insertError } = await adminClient
            .from('calls')
            .insert({
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
                // value is accepted but not stored (calls table uses intent_* + lead_score)
                ...(value !== null ? { _client_value: value } : {}),
            })
            .select()
            .single();

        if (insertError) {
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
                call_id: callRecord.id,
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
