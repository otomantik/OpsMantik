import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { rateLimit, getClientId } from '@/lib/rate-limit';
import { computeAttribution, extractUTM } from '@/lib/attribution';
import { extractGeoInfo } from '@/lib/geo';
import { computeLeadScore } from '@/lib/scoring';
import { parseAllowedOrigins, isOriginAllowed } from '@/lib/cors';
import { getRecentMonths, createSyncResponse } from '@/lib/sync-utils';
import { debugLog, debugWarn } from '@/lib/utils';
import { logInfo, logError } from '@/lib/log';
import * as Sentry from '@sentry/nextjs';

// UUID v4 generator (RFC 4122 compliant)
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
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
        // sendBeacon behaves like credentials: 'include' in many browsers
        // If the browser sends credentials, preflight requires this to be explicitly true.
        headers['Access-Control-Allow-Credentials'] = 'true';
    }

    // Preflight response
    return new NextResponse(null, {
        status: isAllowed ? 200 : 403,
        headers,
    });
}

const SYNC_ROUTE = '/api/sync';

export async function POST(req: NextRequest) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
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
            // Required for credentialed CORS requests (e.g. sendBeacon in some browsers)
            baseHeaders['Access-Control-Allow-Credentials'] = 'true';
        }

        if (!isAllowed) {
            debugWarn('[CORS] Origin not allowed:', origin, 'Reason:', reason, 'Allowed list:', ALLOWED_ORIGINS);
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

        debugLog('[SYNC_IN] Incoming payload:', {
            site_id: rawBody.s,
            month: rawBody.sm,
            url: rawBody.u,
            referrer: rawBody.r,
            meta: rawBody.meta,
            event_category: rawBody.ec,
            event_action: rawBody.ea,
        });
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

        debugLog('[SYNC_DB] Searching site with IDs:', searchIds);

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

        debugLog('[SYNC_VALID] Site verified. Internal ID:', site.id);

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

        debugLog('[SYNC_API] Attribution computed:', {
            gclid: currentGclid ? 'present' : 'missing',
            utm_medium: utm?.medium || 'none',
            referrer: referrer ? (referrer.includes('http') ? new URL(referrer).hostname : referrer) : 'none',
                hasPastGclid,
                attributionSource,
                device_type: deviceType,
                city: geoInfo.city,
                district: geoInfo.district,
        });

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
                    debugLog('[SYNC_API] Found existing session:', client_sid, 'in partition:', dbMonth);
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
                    debugLog('[SYNC_API] No existing session found for UUID:', client_sid, 'in partition:', dbMonth);
                }
            } else {
                debugWarn('[SYNC_API] Invalid UUID format for session_id:', client_sid, '- will create new session');
            }

            // Step B: Create session if not found
            if (!session) {
                // Generate UUID if client_sid is not valid UUID
                const finalSessionId = isUuid ? client_sid : generateUUID();

                debugLog('[SYNC_API] Creating NEW session:', {
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
                debugLog('[SYNC_API] Inserting event for session:', session.id);

                // Determine category: GCLID affects only user interactions, not system events
                let finalCategory = event_category || 'interaction';

                // Override to acquisition only for non-system, non-conversion events with GCLID
                // P0: Ads phone/wa clicks are sent as conversion events; do NOT rewrite them,
                // otherwise call-intent creation (which gates on finalCategory==='conversion') is skipped.
                if (currentGclid && event_category !== 'system' && event_category !== 'conversion') {
                    finalCategory = 'acquisition';
                }

                const { error: eError } = await adminClient
                    .from('events')
                    .insert({
                        session_id: session.id,
                        session_month: session.created_month,
                        site_id: site.id,
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
                debugLog('[SYNC_API] ✅ SUCCESS: Event inserted to DB:', {
                    event_id: session.id.slice(0, 8) + '...',
                    action: event_action,
                    category: finalCategory,
                    session_id: session.id.slice(0, 8) + '...',
                    partition: session.created_month
                });

                // Step D (Phase 1): Click-intent creation (decoupled from event_category)
                // Goal: tel/wa clicks MUST create call intents regardless of acquisition/conversion rewrites.
                const PHONE_ACTIONS = new Set(['phone_call', 'phone_click', 'call_click', 'tel_click']);
                const WHATSAPP_ACTIONS = new Set(['whatsapp', 'whatsapp_click', 'wa_click']);

                const rawAction = (meta?.intent_action || event_action || '').toString().trim().toLowerCase();
                const action = rawAction;
                const isPhone = PHONE_ACTIONS.has(action);
                const isWa = WHATSAPP_ACTIONS.has(action);

                // Back-compat: treat legacy actions/labels as phone/wa signals
                const labelLc = (event_label || '').toString().toLowerCase();
                const legacyPhoneSignal =
                    ['phone_call', 'phone_click', 'call_click'].includes((event_action || '').toString().toLowerCase()) ||
                    labelLc.startsWith('tel:');
                const legacyWaSignal =
                    ((event_action || '').toString().toLowerCase() === 'whatsapp') ||
                    labelLc.includes('wa.me') ||
                    labelLc.includes('whatsapp.com');

                const shouldCreateIntent = !!session && (!!fingerprint || !!session.id) && (isPhone || isWa || legacyPhoneSignal || legacyWaSignal);

                if (shouldCreateIntent) {
                    // Normalize target for dedupe
                    const rand4 = (): string => Math.random().toString(36).slice(2, 6).padEnd(4, '0');
                    const hash6 = (v: string): string => {
                        const s = (v || '').toString();
                        let h = 0;
                        for (let i = 0; i < s.length; i++) {
                            h = ((h << 5) - h) + s.charCodeAt(i);
                            h |= 0;
                        }
                        const out = Math.abs(h).toString(36);
                        return out.slice(0, 6).padEnd(6, '0');
                    };

                    const canonicalizePhoneDigits = (raw: string): string | null => {
                        const s = (raw || '').toString().trim();
                        if (!s) return null;
                        // Allow leading '+' and digits only
                        let cleaned = s.replace(/[^\d+]/g, '');
                        if (!cleaned) return null;

                        // Convert 00CC... => +CC...
                        if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);

                        // Extract digits only for heuristics
                        const digits = cleaned.replace(/[^\d]/g, '');
                        const hasPlus = cleaned.startsWith('+');

                        // TR heuristics: prefer +90 if no explicit CC
                        if (!hasPlus) {
                            if (digits.length === 10) return `+90${digits}`;
                            if (digits.length === 11 && digits.startsWith('0')) return `+90${digits.slice(1)}`;
                            if (digits.length >= 11 && digits.startsWith('90')) return `+${digits}`;
                            return `+${digits}`;
                        }

                        // Has plus already
                        if (digits.length >= 11 && digits.startsWith('90')) return `+${digits}`;
                        return `+${digits}`;
                    };

                    const normalizeTelTarget = (v: string): string => {
                        const s = (v || '').toString().trim();
                        const noScheme = s.toLowerCase().startsWith('tel:') ? s.slice(4) : s;
                        const phone = canonicalizePhoneDigits(noScheme);
                        return phone ? `tel:${phone}` : 'tel:unknown';
                    };

                    const normalizeWaTarget = (v: string): string => {
                        const raw = (v || '').toString().trim();
                        if (!raw) return 'wa:unknown';
                        const candidate = raw.replace(/^https?:\/\//i, '');

                        // Try parse as URL when possible
                        let url: URL | null = null;
                        try {
                            url = new URL(raw.match(/^https?:\/\//i) ? raw : `https://${candidate}`);
                        } catch {
                            url = null;
                        }

                        // 1) phone= query param (web.whatsapp.com/send?phone=..., whatsapp.com/send?phone=...)
                        const phoneParam = url?.searchParams?.get('phone') || url?.searchParams?.get('p');
                        if (phoneParam) {
                            const phone = canonicalizePhoneDigits(phoneParam);
                            if (phone) return `wa:${phone}`;
                        }

                        // 2) wa.me/<digits>
                        if (url?.hostname?.toLowerCase() === 'wa.me') {
                            const seg = (url.pathname || '').split('/').filter(Boolean)[0] || '';
                            const phone = canonicalizePhoneDigits(seg);
                            if (phone) return `wa:${phone}`;
                        }

                        // 3) whatsapp.com/send?phone= already handled; attempt extract from path if any digits
                        const pathDigits = (url?.pathname || '').replace(/[^\d]/g, '');
                        if (pathDigits && pathDigits.length >= 10) {
                            const phone = canonicalizePhoneDigits(pathDigits);
                            if (phone) return `wa:${phone}`;
                        }

                        // Fallback: deterministic host/path key
                        const host = url?.hostname ? url.hostname.toLowerCase() : candidate.split('/')[0].toLowerCase();
                        const path = url?.pathname ? url.pathname : ('/' + candidate.split('/').slice(1).join('/'));
                        const safe = `${host}${path}`.replace(/\/+$/, '');
                        return `wa:${safe || 'unknown'}`;
                    };

                    // Canonical storage intent_action (Phase 1.1)
                    const canonicalAction: 'phone' | 'whatsapp' = (isPhone || legacyPhoneSignal) ? 'phone' : 'whatsapp';
                    const canonicalTarget = canonicalAction === 'phone'
                        ? normalizeTelTarget(event_label || meta?.phone_number || '')
                        : normalizeWaTarget(event_label || '');

                    // Live Inbox: lightweight display fields (no heavy joins)
                    const intentPageUrl = (typeof url === 'string' && url.length > 0) ? url.slice(0, 2048) : null;
                    const clickId =
                        currentGclid
                        || params.get('wbraid') || meta?.wbraid
                        || params.get('gbraid') || meta?.gbraid
                        || null;

                    // Server fallback stamp: every click-intent must have one
                    const intentStampRaw = meta?.intent_stamp;
                    let intentStamp = (typeof intentStampRaw === 'string' && intentStampRaw.trim().length > 0)
                        ? intentStampRaw.trim()
                        : '';
                    if (!intentStamp) {
                        intentStamp = `${Date.now()}-${rand4()}-${canonicalAction}-${hash6(canonicalTarget)}`;
                    }
                    intentStamp = intentStamp.slice(0, 128);

                    // Preferred idempotency: (site_id, intent_stamp) unique
                    let stampEnsured = false;
                    if (intentStamp) {
                        const { error: upsertErr } = await adminClient
                            .from('calls')
                            .upsert({
                                site_id: site.id,
                                phone_number: canonicalTarget || 'Unknown',
                                matched_session_id: session.id,
                                matched_fingerprint: fingerprint,
                                lead_score: leadScore,
                                lead_score_at_match: leadScore,
                                status: 'intent',
                                source: 'click',
                                intent_stamp: intentStamp,
                                intent_action: canonicalAction,
                                intent_target: canonicalTarget,
                                intent_page_url: intentPageUrl,
                                click_id: clickId,
                            }, { onConflict: 'site_id,intent_stamp', ignoreDuplicates: true });

                        if (upsertErr) {
                            debugWarn('[SYNC_API] intent_stamp upsert failed (falling back to 10s dedupe):', {
                                message: upsertErr.message,
                                code: upsertErr.code,
                            });
                        } else {
                            stampEnsured = true;
                            debugLog('[SYNC_API] ✅ Call intent ensured (stamp):', {
                                intent_stamp: intentStamp,
                                intent_action: canonicalAction,
                            });
                        }
                    }

                    if (!stampEnsured) {
                        // Fallback dedupe (10s): site_id + matched_session_id + action + target
                        const tenSecondsAgo = new Date(Date.now() - 10 * 1000).toISOString();
                        const { data: existingIntent } = await adminClient
                            .from('calls')
                            .select('id')
                            .eq('site_id', site.id)
                            .eq('matched_session_id', session.id)
                            .eq('source', 'click')
                            .or('status.eq.intent,status.is.null')
                            .eq('intent_action', canonicalAction)
                            .eq('intent_target', canonicalTarget)
                            .gte('created_at', tenSecondsAgo)
                            .maybeSingle();

                        if (!existingIntent) {
                            const { error: callError } = await adminClient
                                .from('calls')
                                .insert({
                                    site_id: site.id,
                                    phone_number: canonicalTarget || 'Unknown',
                                    matched_session_id: session.id,
                                    matched_fingerprint: fingerprint,
                                    lead_score: leadScore,
                                    lead_score_at_match: leadScore,
                                    status: 'intent',
                                    source: 'click',
                                    intent_stamp: intentStamp,
                                    intent_action: canonicalAction,
                                    intent_target: canonicalTarget,
                                    intent_page_url: intentPageUrl,
                                    click_id: clickId,
                                });

                            if (callError) {
                                // Unique conflict can happen if stamp exists but upsert path failed earlier.
                                if (callError.code === '23505') {
                                    debugLog('[SYNC_API] Call intent dedupe (unique): skipping duplicate');
                                } else {
                                    debugWarn('[SYNC_API] Failed to create call intent (fallback):', {
                                        message: callError.message,
                                        code: callError.code,
                                        session_id: session.id.slice(0, 8) + '...',
                                    });
                                }
                            } else {
                                debugLog('[SYNC_API] ✅ Call intent created (fallback):', {
                                    intent_action: canonicalAction,
                                    intent_target: canonicalTarget,
                                    session_id: session.id.slice(0, 8) + '...',
                                });
                            }
                        } else {
                            debugLog('[SYNC_API] Call intent fallback dedupe: skipping duplicate within 10s');
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

        logError(errorMessage, { request_id: requestId, route: SYNC_ROUTE, stack: errorStack });
        Sentry.captureException(error, { tags: { request_id: requestId, route: SYNC_ROUTE } });

        const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

        const errorHeaders: Record<string, string> = {
            'Vary': 'Origin',
            'X-OpsMantik-Version': OPSMANTIK_VERSION,
            'X-CORS-Reason': reason || 'unknown_error',
        };

        if (isAllowed && origin) {
            errorHeaders['Access-Control-Allow-Origin'] = origin;
            errorHeaders['Access-Control-Allow-Credentials'] = 'true';
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
