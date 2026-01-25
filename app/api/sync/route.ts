import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { UAParser } from 'ua-parser-js';
import { rateLimit, getClientId } from '@/lib/rate-limit';

// UUID v4 generator (RFC 4122 compliant)
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// GeoIP - optional, disabled for Edge Runtime compatibility
// Note: geoip-lite requires Node.js runtime and is not compatible with Edge Runtime
// For production, consider using a GeoIP API service instead
const geoip: any = null;

export const dynamic = 'force-dynamic';

// CORS whitelist - add your domains here
// Parse and normalize ALLOWED_ORIGINS: trim spaces, support http/https for localhost
const parseAllowedOrigins = (): string[] => {
    const raw = process.env.ALLOWED_ORIGINS;
    if (!raw) return ['*'];
    
    // Split by comma, trim each entry, filter empty strings
    const origins = raw.split(',')
        .map(o => o.trim())
        .filter(o => o.length > 0);
    
    if (origins.length === 0) return ['*'];
    
    // Warn if wildcard found in production
    const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
    if (isProduction && origins.includes('*')) {
        console.warn('[CORS] ⚠️ WARNING: Wildcard (*) found in ALLOWED_ORIGINS in production. This allows all origins and is a security risk.');
    }
    
    return origins;
};

const ALLOWED_ORIGINS = parseAllowedOrigins();

const isOriginAllowed = (origin: string | null): boolean => {
    if (!origin) return false;
    
    // Wildcard allows all (with warning in production)
    if (ALLOWED_ORIGINS.includes('*')) return true;
    
    // Normalize origin URL for comparison
    const normalizeOrigin = (url: string): string => {
        try {
            const urlObj = new URL(url);
            // Return full origin (protocol + hostname + port)
            return urlObj.origin;
        } catch {
            // If URL parsing fails, return as-is
            return url;
        }
    };
    
    const normalizedOrigin = normalizeOrigin(origin);
    
    // Check against allowed origins
    return ALLOWED_ORIGINS.some(allowed => {
        // Normalize allowed origin (add protocol if missing)
        let normalizedAllowed: string;
        if (allowed.startsWith('http://') || allowed.startsWith('https://')) {
            normalizedAllowed = normalizeOrigin(allowed);
        } else {
            // If no protocol, assume https for non-localhost, http for localhost
            if (allowed.includes('localhost') || allowed.includes('127.0.0.1')) {
                normalizedAllowed = normalizeOrigin(`http://${allowed}`);
            } else {
                normalizedAllowed = normalizeOrigin(`https://${allowed}`);
            }
        }
        
        // Exact match
        if (normalizedOrigin === normalizedAllowed) return true;
        
        // For localhost: support both http and https (dev flexibility)
        if (normalizedOrigin.includes('localhost') || normalizedOrigin.includes('127.0.0.1')) {
            const httpVersion = normalizedOrigin.replace('https://', 'http://');
            const httpsVersion = normalizedOrigin.replace('http://', 'https://');
            return normalizedAllowed === httpVersion || normalizedAllowed === httpsVersion;
        }
        
        // Substring match for domain variations (e.g., www.example.com matches example.com)
        return normalizedOrigin.includes(normalizedAllowed.replace(/^https?:\/\//, '')) ||
               normalizedAllowed.includes(normalizedOrigin.replace(/^https?:\/\//, ''));
    });
};

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get('origin');
    const allowedOrigin = isOriginAllowed(origin) ? origin || '*' : ALLOWED_ORIGINS[0];
    
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400', // 24 hours
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

        // Rate limiting: 100 requests per minute per IP
        const clientId = getClientId(req);
        const rateLimitResult = rateLimit(clientId, 100, 60 * 1000);
        
        if (!rateLimitResult.allowed) {
            return NextResponse.json(
                { error: 'Rate limit exceeded', retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000) },
                {
                    status: 429,
                    headers: {
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
            const origin = req.headers.get('origin');
            const allowedOrigin = isOriginAllowed(origin) ? origin || '*' : ALLOWED_ORIGINS[0];
            return NextResponse.json(
                { status: 'error', message: 'Invalid JSON payload' },
                {
                    status: 400,
                    headers: {
                        'Access-Control-Allow-Origin': allowedOrigin,
                    },
                }
            );
        }
        
        console.log('[SYNC_IN] Incoming payload from site:', rawBody.s, 'month:', rawBody.sm);
        // atomic payload mapping
        const {
            s: site_id, u: url,
            sid: client_sid, sm: session_month,
            ec: event_category, ea: event_action, el: event_label, ev: event_value,
            meta, r: referrer
        } = rawBody;

        if (!site_id || !url) return NextResponse.json({ status: 'synced' });

        // 1. Validate Site
        const { data: site, error: siteError } = await adminClient
            .from('sites')
            .select('id')
            .eq('public_id', site_id)
            .maybeSingle();

        if (siteError) {
            console.error('[SYNC_ERROR] Site query error:', site_id, siteError?.message, siteError?.code);
            return NextResponse.json({ status: 'synced' });
        }

        if (!site) {
            console.error('[SYNC_ERROR] Site not found:', site_id);
            return NextResponse.json({ status: 'synced' });
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

        // Device & Geo Enrichment
        const parser = new UAParser(userAgent);
        
        // Normalize device_type to desktop/mobile/tablet
        const rawDeviceType = parser.getDevice().type;
        let deviceType = 'desktop'; // default
        if (rawDeviceType === 'mobile') {
            deviceType = 'mobile';
        } else if (rawDeviceType === 'tablet') {
            deviceType = 'tablet';
        } else {
            // Fallback: check user agent for mobile/tablet patterns
            const uaLower = userAgent.toLowerCase();
            if (uaLower.includes('mobile') || uaLower.includes('android') || uaLower.includes('iphone')) {
                deviceType = 'mobile';
            } else if (uaLower.includes('tablet') || uaLower.includes('ipad')) {
                deviceType = 'tablet';
            }
        }
        
        const deviceInfo = {
            device_type: deviceType,
            os: parser.getOS().name || 'Unknown',
            browser: parser.getBrowser().name || 'Unknown',
            browser_version: parser.getBrowser().version,
        };

        // Geo extraction from headers (Edge Runtime compatible)
        // Priority: CF-IPCity (Cloudflare) > X-City > fallback
        const cityFromHeader = req.headers.get('cf-ipcity') || 
                               req.headers.get('x-city') || 
                               req.headers.get('x-forwarded-city') ||
                               null;
        
        const districtFromHeader = req.headers.get('cf-ipdistrict') ||
                                  req.headers.get('x-district') ||
                                  null;
        
        const geoInfo = {
            city: cityFromHeader || 'Unknown',
            district: districtFromHeader || null, // nullable district_hint
            country: req.headers.get('cf-ipcountry') || 
                     req.headers.get('x-country') || 
                     'Unknown',
            timezone: req.headers.get('cf-timezone') || 
                     req.headers.get('x-timezone') || 
                     'Unknown',
        };

        // 3. Multi-Touch Attribution Check (The "Memory")
        let attributionSource = currentGclid ? 'First Click (Paid)' : 'Organic';
        let isReturningAdUser = false;

        // Check if returning ad user (multi-touch attribution)
        if (!currentGclid && fingerprint) {
            // Query past sessions with ads params, matched by fingerprint
            const { data: pastEvents } = await adminClient
                .from('events')
                .select('metadata, created_at')
                .eq('session_id', fingerprint)  // We'll store fingerprint in metadata
                .or(`metadata->>'gclid' != null`)
                .order('created_at', { ascending: false })
                .limit(1);

            if (pastEvents && pastEvents.length > 0) {
                attributionSource = 'Return Visitor (Ads Assisted)';
                isReturningAdUser = true;
            }
        }
        
        // Fallback: Check client-side persisted GCLID
        if (!currentGclid && meta?.gclid) {
            attributionSource = 'Return Visitor (Ads Assisted)';
            isReturningAdUser = true;
        }

        // 4. Lead Scoring Engine (The "Math")
        let leadScore = 0;

        // A. Category Scoring
        if (event_category === 'conversion') leadScore += 50;
        if (event_category === 'interaction') leadScore += 10;

        // B. Deep Engagement Scoring
        if (event_action === 'scroll_depth') {
            const depth = Number(event_value);
            if (depth >= 50) leadScore += 10;
            if (depth >= 90) leadScore += 20;
        }

        if (event_action === 'hover_intent') leadScore += 15;

        // C. Context Scoring
        if (referrer?.includes('google')) leadScore += 5;
        if (isReturningAdUser) leadScore += 25; // Returning ad users are high intent

        // Cap Score
        leadScore = Math.min(leadScore, 100);

        // 5. Intelligence Summary
        let summary = 'Standard Traffic';
        if (leadScore > 60) summary = '🔥 Hot Lead';
        if (leadScore > 80) summary = '💎 Premium Opportunity';
        if (attributionSource.includes('Ads')) summary += ' (Ads Origin)';

        // 6. Partitioned Persistence Strategy
        const dbMonth = session_month || new Date().toISOString().slice(0, 7) + '-01';

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
                    .select('id, created_month')
                    .eq('id', client_sid)
                    .eq('created_month', dbMonth)
                    .maybeSingle();

                if (lookupError) {
                    console.error('[SYNC_API] Session lookup error:', lookupError.message);
                } else if (existingSession) {
                    console.log('[SYNC_API] Found existing session:', client_sid, 'in partition:', dbMonth);
                    session = existingSession;
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
                    created_month: dbMonth
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
            const errorCode = (dbError as any)?.code;
            const errorDetails = (dbError as any)?.details;
            
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
            const allowedOrigin = isOriginAllowed(origin) ? origin || '*' : ALLOWED_ORIGINS[0];
            return NextResponse.json(
                { status: 'error', message: 'Database write failed' },
                {
                    status: 500,
                    headers: {
                        'Access-Control-Allow-Origin': allowedOrigin,
                    },
                }
            );
        }

        // Use origin from the beginning of the function (line 42)
        const allowedOrigin = isOriginAllowed(origin) ? origin || '*' : ALLOWED_ORIGINS[0];
        
        return NextResponse.json(
            { status: 'synced', score: leadScore },
            {
                headers: {
                    'Access-Control-Allow-Origin': allowedOrigin,
                    'X-RateLimit-Limit': '100',
                    'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
                },
            }
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const origin = req.headers.get('origin');
        const allowedOrigin = isOriginAllowed(origin) ? origin || '*' : ALLOWED_ORIGINS[0];
        
        // Enhanced error logging
        console.error('[SYNC_API] Tracking Error:', {
            message: errorMessage,
            stack: errorStack,
            timestamp: new Date().toISOString(),
            url: req.url
        });
        
        return NextResponse.json(
            { status: 'error', message: errorMessage },
            {
                status: 500,
                headers: {
                    'Access-Control-Allow-Origin': allowedOrigin,
                },
            }
        );
    }
}
