import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { rateLimit, getClientId } from '@/lib/rate-limit';
import { parseAllowedOrigins, isOriginAllowed } from '@/lib/cors';
import { getRecentMonths } from '@/lib/sync-utils';
import { debugLog, debugWarn } from '@/lib/utils';
import { logInfo, logError } from '@/lib/log';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

// Global version for debug verification
const OPSMANTIK_VERSION = '1.0.2-bulletproof';

// Parse allowed origins (fail-closed in production)
const ALLOWED_ORIGINS = parseAllowedOrigins();

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get('origin');
    const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

    const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
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
        const clientId = getClientId(req);
        const rateLimitResult = rateLimit(clientId, 50, 60 * 1000);

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

        const body = await req.json();
        const { site_id, phone_number, fingerprint } = body;

        if (!site_id || !phone_number || !fingerprint) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400, headers: baseHeaders }
            );
        }

        // 1. Validate Site
        const { data: site, error: siteError } = await adminClient
            .from('sites')
            .select('id')
            .eq('public_id', site_id)
            .single();

        if (siteError || !site) {
            console.error('[CALL_MATCH] Site not found:', site_id);
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
            console.error('[CALL_MATCH] Events query error:', {
                message: eventsError.message,
                code: eventsError.code,
                details: eventsError.details,
                fingerprint,
                timestamp: new Date().toISOString()
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
            debugLog('[CALL_MATCH] Found matching session:', matchedSessionId);

            // Validate: Check session exists and was created before match
            const { data: session, error: sessionError } = await adminClient
                .from('sessions')
                .select('id, created_at, created_month')
                .eq('id', matchedSessionId)
                .eq('created_month', sessionMonth)
                .single();

            if (sessionError || !session) {
                // Session doesn't exist - invalid match
                debugWarn('[CALL_MATCH] Session not found for match:', {
                    call_id: 'pending',
                    session_id: matchedSessionId,
                    error: sessionError?.message
                });
                matchedSessionId = null;
            } else {
                // Check if match is suspicious (session created after match by > 2 minutes)
                const sessionCreatedAt = new Date(session.created_at);
                const matchTime = new Date(matchedAt);
                const timeDiffMinutes = (sessionCreatedAt.getTime() - matchTime.getTime()) / (1000 * 60);

                if (timeDiffMinutes > 2) {
                    // Suspicious: session created more than 2 minutes after match
                    debugWarn('[CALL_MATCH] Suspicious match detected:', {
                        call_id: 'pending',
                        session_id: matchedSessionId,
                        session_created_at: session.created_at,
                        matched_at: matchedAt,
                        time_diff_minutes: timeDiffMinutes.toFixed(2)
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
                    console.error('[CALL_MATCH] Session events query error:', {
                        message: sessionEventsError.message,
                        code: sessionEventsError.code,
                        session_id: matchedSessionId,
                        timestamp: new Date().toISOString()
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
            })
            .select()
            .single();

        if (insertError) {
            console.error('[CALL_MATCH] Insert failed:', insertError.message);
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
