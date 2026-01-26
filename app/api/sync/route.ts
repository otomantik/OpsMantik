import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { rateLimit, getClientId } from '@/lib/rate-limit';
import { computeAttribution, extractUTM } from '@/lib/attribution';
import { extractGeoInfo } from '@/lib/geo';
import { computeLeadScore } from '@/lib/scoring';
import { parseAllowedOrigins, isOriginAllowed } from '@/lib/cors';

// UUID v4 generator (RFC 4122 compliant)
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Get recent months for partition filtering
 * Returns array of month strings in format 'YYYY-MM-01' for last N months
 * 
 * @param months - Number of months to include (default: 6)
 * @returns Array of month strings, e.g., ['2026-01-01', '2025-12-01', ...]
 */
function getRecentMonths(months: number = 6): string[] {
    const result: string[] = [];
    const now = new Date();

    for (let i = 0; i < months; i++) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStr = date.toISOString().slice(0, 7) + '-01';
        result.push(monthStr);
    }

    return result;
}

// GeoIP - optional, disabled for Edge Runtime compatibility
// Note: geoip-lite requires Node.js runtime and is not compatible with Edge Runtime
// For production, consider using a GeoIP API service instead
// Safe initialization helper
function getOriginsSafe(): string[] {
    try {
        return parseAllowedOrigins();
    } catch (err) {
        console.error('[CORS_INIT_FATAL]', err);
        // Fallback to empty to trigger the 'Origin not allowed' path instead of crashing the route
        return [];
    }
}

// Global version for debug verification
const OPSMANTIK_VERSION = '1.0.2-bulletproof';

// Parse allowed origins (init safely to prevent route crash)
const ALLOWED_ORIGINS = getOriginsSafe();

/**
 * Response helper to guarantee { ok, score } contract
 * All responses MUST include both 'ok' and 'score' keys
 * 
 * @param ok - Success status (true = success, false = error)
 * @param score - Lead score (number on success, null on error)
 * @param data - Additional response data
 * @returns Response object with guaranteed contract
 */
function createSyncResponse(
    ok: boolean,
    score: number | null,
    data: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        ok,
        score,
        ...data,
    };
}

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get('origin');
    const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

    const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OpsMantik-Version, X-CORS-Reason',
        'Access-Control-Expose-Headers': 'X-OpsMantik-Version, X-CORS-Reason, X-CORS-Status',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
        'X-OpsMantik-Version': OPSMANTIK_VERSION,
        'X-CORS-Status': isAllowed ? 'allowed' : 'rejected',
        'X-CORS-Reason': reason || 'ok',
        'X-CORS-Received': origin || 'none',
    };

    if (isAllowed && origin) {
        headers['Access-Control-Allow-Origin'] = origin;
    }

    // Preflight response
    return new NextResponse(null, {
        status: isAllowed ? 200 : 403,
        headers,
    });
}

export async function POST(req: NextRequest) {
    try {
        // CORS check
        const origin = req.headers.get('origin');
        const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

        // Base headers for all responses
        const baseHeaders: Record<string, string> = {
            'Access-Control-Expose-Headers': 'X-OpsMantik-Version, X-CORS-Reason, X-CORS-Status',
            'Vary': 'Origin',
            'X-OpsMantik-Version': OPSMANTIK_VERSION,
            'X-CORS-Reason': reason || 'ok',
            'X-CORS-Received': origin || 'none',
        };

        if (isAllowed && origin) {
            baseHeaders['Access-Control-Allow-Origin'] = origin;
        }

        if (!isAllowed) {
            console.warn('[CORS] Origin not allowed:', origin, 'Reason:', reason, 'Allowed list:', ALLOWED_ORIGINS);
            return NextResponse.json(
                createSyncResponse(false, null, {
                    error: 'Origin not allowed',
                    receivedOrigin: origin,
                    reason,
                    configStatus: ALLOWED_ORIGINS.length > 0 ? 'configured' : 'missing_or_invalid'
                }),
                {
                    status: 403,
                    headers: baseHeaders
                }
            );
        }

        // Rate limiting: 100 requests per minute per IP
        const clientId = getClientId(req);
        const rateLimitResult = rateLimit(clientId, 100, 60 * 1000);

        if (!rateLimitResult.allowed) {
            return NextResponse.json(
                createSyncResponse(false, null, {
                    error: 'Rate limit exceeded',
                    retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
                }),
                {
                    status: 429,
                    headers: {
                        ...baseHeaders,
                        'X-RateLimit-Limit': '100',
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': rateLimitResult.resetAt.toString(),
                        'Retry-After': Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000).toString(),
                    },
                }
            );
        }

        let rawBody;
        try {
            rawBody = await req.json();
        } catch (parseError) {
            console.error('[SYNC_API] JSON parse error:', parseError);
            return NextResponse.json(
                createSyncResponse(false, null, { message: 'Invalid JSON payload' }),
                {
                    status: 400,
                    headers: baseHeaders,
                }
            );
        }

        // Debug logging (only in dev mode) - declare once at top of function
        const isDebugMode = process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true';
        if (isDebugMode) {
            console.log('[SYNC_IN] Incoming payload:', {
                site_id: rawBody.s,
                month: rawBody.sm,
                url: rawBody.u,
                referrer: rawBody.r,
                meta: rawBody.meta,
                event_category: rawBody.ec,
                event_action: rawBody.ea,
            });
        } else {
            console.log('[SYNC_IN] Incoming payload from site:', rawBody.s, 'month:', rawBody.sm);
        }
        // atomic payload mapping
        const {
            s: site_id, u: url,
            sid: client_sid, sm: session_month,
            ec: event_category, ea: event_action, el: event_label, ev: event_value,
            meta, r: referrer
        } = rawBody;

        if (!site_id || !url) {
            return NextResponse.json(
                createSyncResponse(true, 0, { status: 'synced_skipped_missing_id' }),
                { headers: baseHeaders }
            );
        }

        // PR-HARD-5: Input validation
        // 1. Validate site_id format (UUID v4 - accept both hyphenated and non-hyphenated)
        // Normalize: remove hyphens, then validate as 32 hex chars, then re-add hyphens
        let normalizedSiteId = site_id;
        if (typeof site_id === 'string') {
            // Remove existing hyphens
            const stripped = site_id.replace(/-/g, '');

            // Check if it's 32 hex characters (UUID without hyphens)
            if (/^[0-9a-f]{32}$/i.test(stripped)) {
                // Re-add hyphens in UUID v4 format: 8-4-4-4-12
                normalizedSiteId =
                    stripped.substring(0, 8) + '-' +
                    stripped.substring(8, 12) + '-' +
                    stripped.substring(12, 16) + '-' +
                    stripped.substring(16, 20) + '-' +
                    stripped.substring(20, 32);
            }
        }

        // Now validate the normalized UUID v4 format
        const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (typeof normalizedSiteId !== 'string' || !uuidV4Regex.test(normalizedSiteId)) {
            return NextResponse.json(
                createSyncResponse(false, null, { message: 'Invalid site_id format' }),
                {
                    status: 400,
                    headers: baseHeaders,
                }
            );
        }

        // Use normalized site_id for database query
        const finalSiteId = normalizedSiteId;

        // 2. Validate url format
        try {
            new URL(url);
        } catch {
            return NextResponse.json(
                createSyncResponse(false, null, { message: 'Invalid url format' }),
                {
                    status: 400,
                    headers: baseHeaders,
                }
            );
        }

        // 1. Validate Site (Search for multiple formats: original, stripped, or hyphenated)
        const strippedId = typeof site_id === 'string' ? site_id.replace(/-/g, '') : site_id;
        const searchIds = Array.from(new Set([site_id, finalSiteId, strippedId]));

        if (isDebugMode) {
            console.log('[SYNC_DB] Searching site with IDs:', searchIds);
        }

        const { data: site, error: siteError } = await adminClient
            .from('sites')
            .select('id')
            .in('public_id', searchIds)
            .maybeSingle();

        if (siteError) {
            console.error('[SYNC_ERROR] Site query error:', site_id, siteError?.message, siteError?.code);
            return NextResponse.json(
                createSyncResponse(false, 0, { message: 'Site validation failed' }),
                { headers: baseHeaders }
            );
        }

        if (!site) {
            console.error('[SYNC_ERROR] Site not found:', site_id);
            return NextResponse.json(
                createSyncResponse(false, 0, { message: 'Site not found' }),
                { status: 404, headers: baseHeaders }
            );
        }

        console.log('[SYNC_VALID] Site verified. Internal ID:', site.id);

        // 2. Context Extraction
        const urlObj = new URL(url);
        const params = urlObj.searchParams;
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '0.0.0.0';
        const userAgent = req.headers.get('user-agent') || 'Unknown';

        // Priority: URL Param > Metadata Persistence
        const currentGclid = params.get('gclid') || meta?.gclid;
        const fingerprint = meta?.fp || null;

        // Device & Geo Enrichment (extracted to lib/geo.ts)
        const { geoInfo, deviceInfo } = extractGeoInfo(req, userAgent, meta);
        const deviceType = deviceInfo.device_type;

        // 3. Attribution Computation (using truth table rules)
        // Extract UTM parameters
        const utm = extractUTM(url);

        // Get dbMonth early for past GCLID query
        const dbMonth = session_month || new Date().toISOString().slice(0, 7) + '-01';

        // Check for past GCLID (multi-touch attribution)
        let hasPastGclid = false;
        if (!currentGclid && fingerprint) {
            // Query past events with GCLID, matched by fingerprint
            // Search in last 6 months (realistic window for attribution)
            const recentMonths = getRecentMonths(6);
            const { data: pastEvents } = await adminClient
                .from('events')
                .select('metadata, created_at, session_month')
                .not('metadata->gclid', 'is', null)
                .in('session_month', recentMonths) // Partition filter: only search last 6 months
                .order('created_at', { ascending: false })
                .limit(50);

            // Check if any past event has matching fingerprint and GCLID
            if (pastEvents && pastEvents.length > 0) {
                hasPastGclid = pastEvents.some((e: unknown) => {
                    const event = e as { metadata?: { fp?: string; gclid?: string } };
                    return event.metadata?.fp === fingerprint && event.metadata?.gclid;
                });
            }
        }

        // Compute attribution using truth table rules
        const attribution = computeAttribution({
            gclid: currentGclid,
            utm,
            referrer: referrer || null,
            fingerprint,
            hasPastGclid,
        });

        const attributionSource = attribution.source;
        const isReturningAdUser = attribution.isPaid && !currentGclid;

        // Debug logging (only in dev mode) - use isDebugMode from above
        if (isDebugMode) {
            console.log('[SYNC_API] Attribution computed:', {
                gclid: currentGclid ? 'present' : 'missing',
                utm_medium: utm?.medium || 'none',
                referrer: referrer ? (referrer.includes('http') ? new URL(referrer).hostname : referrer) : 'none',
                hasPastGclid,
                attributionSource,
                device_type: deviceType,
                city: geoInfo.city,
                district: geoInfo.district,
            });
        }

        // 4. Lead Scoring Engine (extracted to lib/scoring.ts)
        const leadScore = computeLeadScore(
            {
                event_category,
                event_action,
                event_value,
            },
            referrer || null,
            isReturningAdUser
        );

        // 5. Intelligence Summary
        let summary = 'Standard Traffic';
        if (leadScore > 60) summary = '🔥 Hot Lead';
        if (leadScore > 80) summary = '💎 Premium Opportunity';
        if (attributionSource.includes('Ads')) summary += ' (Ads Origin)';

        // 6. Partitioned Persistence Strategy
        // dbMonth already defined above for attribution computation

        try {
            let session;

            // Step A: Attempt to find existing session to satisfy PK/FK constraints
            // UUID v4 validation: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
            // Format: 8-4-4-4-12 hex digits, version 4 (4xxx), variant (8/9/a/b)
            const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            const isUuid = uuidV4Regex.test(client_sid);

            if (isUuid) {
                // Lookup existing session in the correct partition
                const { data: existingSession, error: lookupError } = await adminClient
                    .from('sessions')
                    .select('id, created_month, attribution_source, gclid')
                    .eq('id', client_sid)
                    .eq('created_month', dbMonth)
                    .maybeSingle();

                if (lookupError) {
                    console.error('[SYNC_API] Session lookup error:', lookupError.message);

                    // Fail-fast: return 500 error instead of silently creating new session
                    return NextResponse.json(
                        createSyncResponse(false, null, {
                            message: 'Session lookup failed',
                            details: lookupError.message,
                        }),
                        {
                            status: 500,
                            headers: baseHeaders
                        }
                    );
                } else if (existingSession) {
                    console.log('[SYNC_API] Found existing session:', client_sid, 'in partition:', dbMonth);
                    session = existingSession;

                    // Update existing session with attribution/context if missing
                    if (!existingSession.attribution_source) {
                        await adminClient
                            .from('sessions')
                            .update({
                                attribution_source: attributionSource,
                                device_type: deviceType,
                                city: geoInfo.city !== 'Unknown' ? geoInfo.city : null,
                                district: geoInfo.district,
                                fingerprint: fingerprint,
                                gclid: currentGclid || existingSession.gclid,
                            })
                            .eq('id', client_sid)
                            .eq('created_month', dbMonth);
                    }
                } else {
                    console.log('[SYNC_API] No existing session found for UUID:', client_sid, 'in partition:', dbMonth);
                }
            } else {
                console.warn('[SYNC_API] Invalid UUID format for session_id:', client_sid, '- will create new session');
            }

            // Step B: Create session if not found
            if (!session) {
                // Generate UUID if client_sid is not valid UUID
                const finalSessionId = isUuid ? client_sid : generateUUID();

                console.log('[SYNC_API] Creating NEW session:', {
                    provided_id: client_sid,
                    final_id: finalSessionId,
                    is_uuid: isUuid,
                    partition: dbMonth
                });

                const sessionPayload: Record<string, unknown> = {
                    id: finalSessionId, // Always set ID (UUID or generated)
                    site_id: site.id,
                    ip_address: ip,
                    entry_page: url,
                    gclid: currentGclid,
                    wbraid: params.get('wbraid') || meta?.wbraid,
                    gbraid: params.get('gbraid') || meta?.gbraid,
                    created_month: dbMonth,
                    // Attribution and context fields
                    attribution_source: attributionSource,
                    device_type: deviceType,
                    city: geoInfo.city !== 'Unknown' ? geoInfo.city : null,
                    district: geoInfo.district,
                    fingerprint: fingerprint,
                };

                const { data: newSession, error: sError } = await adminClient
                    .from('sessions')
                    .insert(sessionPayload)
                    .select('id, created_month')
                    .single();

                if (sError) {
                    console.error('[SYNC_API] Session insert failed:', {
                        message: sError.message,
                        code: sError.code,
                        details: sError.details,
                        session_id: finalSessionId,
                        partition: dbMonth
                    });
                    throw sError;
                }
                session = newSession;
            }

            // Step C: Insert Event (Atomic)
            if (session) {
                console.log('[SYNC_API] Inserting event for session:', session.id);

                // Determine category: GCLID affects only user interactions, not system events
                let finalCategory = event_category || 'interaction';

                // Override to acquisition only for non-system events with GCLID
                if (currentGclid && event_category !== 'system') {
                    finalCategory = 'acquisition';
                }

                const { error: eError } = await adminClient
                    .from('events')
                    .insert({
                        session_id: session.id,
                        session_month: session.created_month,
                        url: url,
                        event_category: finalCategory,
                        event_action: event_action || 'view',
                        event_label: event_label,
                        event_value: event_value ? Number(event_value) : null,
                        metadata: {
                            referrer,
                            ...meta,
                            client_sid,
                            fingerprint: fingerprint,
                            user_agent: userAgent,
                            // Device info
                            ...deviceInfo,
                            // Geo info
                            ...geoInfo,
                            // Scoring & attribution
                            lead_score: leadScore,
                            attribution_source: attributionSource,
                            intelligence_summary: summary,
                            is_attributed_to_ads: !!currentGclid,
                            gclid: currentGclid,
                            ip_anonymized: ip.replace(/\.\d+$/, '.0')
                        }
                    });

                if (eError) {
                    console.error('[SYNC_API] Event insert failed:', {
                        message: eError.message,
                        code: eError.code,
                        details: eError.details,
                        session_id: session.id,
                        session_month: session.created_month
                    });
                    throw eError;
                }
                console.log('[SYNC_API] ✅ SUCCESS: Event inserted to DB:', {
                    event_id: session.id.slice(0, 8) + '...',
                    action: event_action,
                    category: finalCategory,
                    session_id: session.id.slice(0, 8) + '...',
                    partition: session.created_month
                });

                // Step D: Create Call Intent if phone/whatsapp click
                if (finalCategory === 'conversion' && fingerprint) {
                    const phoneActions = ['phone_call', 'whatsapp', 'phone_click', 'call_click'];
                    const isPhoneAction = phoneActions.some(action =>
                        event_action?.toLowerCase().includes(action) ||
                        event_label?.toLowerCase().includes('phone') ||
                        event_label?.toLowerCase().includes('whatsapp')
                    );

                    if (isPhoneAction) {
                        // Extract phone number from label or metadata
                        const phoneNumber = event_label || meta?.phone_number || 'Unknown';

                        // Dedupe: Check if intent exists in last 60 seconds for same session+source
                        const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString();
                        const { data: existingIntent } = await adminClient
                            .from('calls')
                            .select('id')
                            .eq('site_id', site.id)
                            .eq('matched_session_id', session.id)
                            .eq('source', 'click')
                            .eq('status', 'intent')
                            .gte('created_at', sixtySecondsAgo)
                            .maybeSingle();

                        if (!existingIntent) {
                            // Create soft intent call
                            const { error: callError } = await adminClient
                                .from('calls')
                                .insert({
                                    site_id: site.id,
                                    phone_number: phoneNumber,
                                    matched_session_id: session.id,
                                    matched_fingerprint: fingerprint,
                                    lead_score: leadScore,
                                    lead_score_at_match: leadScore,
                                    status: 'intent',
                                    source: 'click',
                                    // Note: We don't set matched_at for intents (only for real calls)
                                });

                            if (callError) {
                                // Log but don't fail the event insert
                                console.warn('[SYNC_API] Failed to create call intent:', {
                                    message: callError.message,
                                    code: callError.code,
                                    session_id: session.id.slice(0, 8) + '...',
                                });
                            } else {
                                console.log('[SYNC_API] ✅ Call intent created:', {
                                    phone_number: phoneNumber,
                                    session_id: session.id.slice(0, 8) + '...',
                                    lead_score: leadScore,
                                });
                            }
                        } else {
                            console.log('[SYNC_API] Call intent dedupe: skipping duplicate intent within 60s');
                        }
                    }
                }

                // Update session metadata (duration, exit page, event count)
                if (event_action === 'heartbeat' || event_action === 'session_end') {
                    const updates: Record<string, unknown> = {};

                    if (meta?.duration_sec) {
                        updates.total_duration_sec = meta.duration_sec;
                    }

                    if (event_action === 'session_end' && meta?.exit_page) {
                        updates.exit_page = meta.exit_page;
                    }

                    // Increment event count
                    const { data: currentSession } = await adminClient
                        .from('sessions')
                        .select('event_count')
                        .eq('id', session.id)
                        .eq('created_month', session.created_month)
                        .single();

                    if (currentSession) {
                        updates.event_count = (currentSession.event_count || 0) + 1;
                    }

                    if (Object.keys(updates).length > 0) {
                        await adminClient
                            .from('sessions')
                            .update(updates)
                            .eq('id', session.id)
                            .eq('created_month', session.created_month);
                    }
                }
            }

        } catch (dbError) {
            const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
            const errorStack = dbError instanceof Error ? dbError.stack : undefined;
            const errorCode = (dbError as unknown as { code?: string })?.code;
            const errorDetails = (dbError as unknown as { details?: string })?.details;

            // Enhanced error logging
            console.error('[PARTITION_FAULT] DB Write Failed:', {
                message: errorMessage,
                code: errorCode,
                details: errorDetails,
                stack: errorStack,
                site_id: rawBody.s,
                session_id: client_sid,
                timestamp: new Date().toISOString()
            });

            // Return error response but don't break the client
            // This prevents retry loops in tracker while logging the failure
            return NextResponse.json(
                createSyncResponse(false, null, { message: 'Database write failed' }),
                {
                    status: 500,
                    headers: baseHeaders
                }
            );
        }

        // Use baseHeaders for the success response
        return NextResponse.json(
            createSyncResponse(true, leadScore, { status: 'synced' }),
            {
                headers: {
                    ...baseHeaders,
                    'X-RateLimit-Limit': '100',
                    'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
                },
            }
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const origin = req.headers.get('origin');

        // Enhanced error logging
        console.error('[SYNC_API] Tracking Error:', {
            message: errorMessage,
            stack: errorStack,
            timestamp: new Date().toISOString(),
            url: req.url
        });

        const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

        const errorHeaders: Record<string, string> = {
            'Vary': 'Origin',
            'X-OpsMantik-Version': OPSMANTIK_VERSION,
            'X-CORS-Reason': reason || 'unknown_error',
        };

        if (isAllowed && origin) {
            errorHeaders['Access-Control-Allow-Origin'] = origin;
        }

        return NextResponse.json(
            createSyncResponse(false, null, { message: errorMessage }),
            {
                status: 500,
                headers: errorHeaders,
            }
        );
    }
}
