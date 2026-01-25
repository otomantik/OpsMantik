import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { rateLimit, getClientId } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// CORS whitelist
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
const isOriginAllowed = (origin: string | null): boolean => {
    if (ALLOWED_ORIGINS.includes('*')) return true;
    if (!origin) return false;
    return ALLOWED_ORIGINS.some(allowed => origin.includes(allowed));
};

export async function OPTIONS(req: NextRequest) {
    const requestOrigin = req.headers.get('origin');
    const allowedOrigin = isOriginAllowed(requestOrigin) ? requestOrigin || '*' : ALLOWED_ORIGINS[0];
    
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
        },
    });
}

export async function POST(req: NextRequest) {
    try {
        // CORS check
        const origin = req.headers.get('origin');
        if (!isOriginAllowed(origin)) {
            return NextResponse.json(
                { error: 'Origin not allowed' },
                { status: 403 }
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
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // 1. Validate Site
        const { data: site, error: siteError } = await adminClient
            .from('sites')
            .select('id')
            .eq('public_id', site_id)
            .single();

        if (siteError || !site) {
            console.error('[CALL_MATCH] Site not found:', site_id);
            return NextResponse.json({ error: 'Site not found' }, { status: 404 });
        }

        // 2. Find most recent session for this fingerprint (within last 30 minutes)
        // Search in events metadata for fingerprint
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        
        const { data: recentEvents, error: eventsError } = await adminClient
            .from('events')
            .select('session_id, session_month, metadata, created_at')
            .eq('metadata->>fingerprint', fingerprint)
            .gte('created_at', thirtyMinutesAgo)
            .order('created_at', { ascending: false })
            .limit(1);

        if (eventsError) {
            console.error('[CALL_MATCH] Events query error:', {
                message: eventsError.message,
                code: eventsError.code,
                details: eventsError.details,
                fingerprint,
                timestamp: new Date().toISOString()
            });
        }

        let matchedSessionId: string | null = null;
        let leadScore = 0;
        let scoreBreakdown: any = null;
        const matchedAt = new Date().toISOString();

        if (recentEvents && recentEvents.length > 0) {
            matchedSessionId = recentEvents[0].session_id;
            console.log('[CALL_MATCH] Found matching session:', matchedSessionId);

            // 3. Calculate lead score from session events
            const { data: sessionEvents, error: sessionEventsError } = await adminClient
                .from('events')
                .select('event_category, event_action, metadata')
                .eq('session_id', matchedSessionId)
                .eq('session_month', recentEvents[0].session_month);

            if (sessionEventsError) {
                console.error('[CALL_MATCH] Session events query error:', {
                    message: sessionEventsError.message,
                    code: sessionEventsError.code,
                    session_id: matchedSessionId,
                    timestamp: new Date().toISOString()
                });
            }

            if (sessionEvents && sessionEvents.length > 0) {
                // Count conversion events
                const conversionCount = sessionEvents.filter(e => e.event_category === 'conversion').length;
                const interactionCount = sessionEvents.filter(e => e.event_category === 'interaction').length;
                
                // Get max lead score from metadata
                const scores = sessionEvents.map(e => Number((e.metadata as any)?.lead_score) || 0);
                const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

                // Calculate score breakdown
                const conversionPoints = conversionCount * 20;
                const interactionPoints = interactionCount * 5;
                const bonuses = maxScore;
                const rawScore = conversionPoints + interactionPoints + bonuses;
                const cappedAt100 = rawScore > 100;

                leadScore = Math.min(rawScore, 100);
                
                // Store score breakdown for evidence
                scoreBreakdown = {
                    conversionPoints,
                    interactionPoints,
                    bonuses,
                    cappedAt100,
                    rawScore,
                    finalScore: leadScore
                };
                
                console.log('[CALL_MATCH] Calculated lead score:', leadScore, scoreBreakdown);
            } else {
                console.log('[CALL_MATCH] No events found for session, using default score');
            }
        } else {
            console.log('[CALL_MATCH] No matching session found for fingerprint:', fingerprint);
        }

        // 4. Insert call record with enriched matching evidence
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
            })
            .select()
            .single();

        if (insertError) {
            console.error('[CALL_MATCH] Insert failed:', {
                message: insertError.message,
                code: insertError.code,
                details: insertError.details,
                phone_number,
                session_id: matchedSessionId,
                timestamp: new Date().toISOString()
            });
            return NextResponse.json({ error: 'Failed to record call' }, { status: 500 });
        }

        console.log('[CALL_MATCH] Success:', {
            call_id: callRecord.id,
            session_id: matchedSessionId,
            lead_score: leadScore,
        });

        const allowedOrigin = isOriginAllowed(origin) ? origin || '*' : ALLOWED_ORIGINS[0];
        
        return NextResponse.json(
            {
                status: 'matched',
                call_id: callRecord.id,
                session_id: matchedSessionId,
                lead_score: leadScore,
            },
            {
                headers: {
                    'Access-Control-Allow-Origin': allowedOrigin,
                    'X-RateLimit-Limit': '50',
                    'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
                },
            }
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        console.error('[CALL_MATCH] Error:', {
            message: errorMessage,
            stack: errorStack,
            timestamp: new Date().toISOString(),
            url: req.url
        });
        
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
