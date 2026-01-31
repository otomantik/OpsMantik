import { NextRequest, NextResponse } from 'next/server';
import { RateLimitService } from '@/lib/services/RateLimitService';
import { extractGeoInfo } from '@/lib/geo';
import { parseAllowedOrigins, isOriginAllowed } from '@/lib/cors';
import { createSyncResponse } from '@/lib/sync-utils';
import { debugWarn } from '@/lib/utils';
import { logError } from '@/lib/log';
import * as Sentry from '@sentry/nextjs';

// Services
import { SiteService } from '@/lib/services/site-service';
import { AttributionService } from '@/lib/services/attribution-service';
import { SessionService } from '@/lib/services/session-service';
import { EventService } from '@/lib/services/event-service';
import { IntentService } from '@/lib/services/intent-service';

// Global version for debug verification
const OPSMANTIK_VERSION = '2.0.0-enterprise';

// Parse allowed origins (init safely to prevent route crash)
function getOriginsSafe(): string[] {
    try {
        return parseAllowedOrigins();
    } catch (err) {
        console.error('[CORS_INIT_FATAL]', err);
        return [];
    }
}
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
        headers['Access-Control-Allow-Credentials'] = 'true';
    }

    return new NextResponse(null, { status: isAllowed ? 200 : 403, headers });
}

export async function POST(req: NextRequest) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    try {
        // --- 1. Security & Infrastructure Layer ---
        const origin = req.headers.get('origin');
        const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

        const baseHeaders: Record<string, string> = {
            'Access-Control-Expose-Headers': 'X-OpsMantik-Version, X-CORS-Reason, X-CORS-Status',
            'Vary': 'Origin',
            'X-OpsMantik-Version': OPSMANTIK_VERSION,
            'X-CORS-Reason': reason || 'ok',
            'X-CORS-Received': origin || 'none',
        };

        if (isAllowed && origin) {
            baseHeaders['Access-Control-Allow-Origin'] = origin;
            baseHeaders['Access-Control-Allow-Credentials'] = 'true';
        }

        if (!isAllowed) {
            debugWarn('[CORS] Origin not allowed:', origin);
            return NextResponse.json(
                createSyncResponse(false, null, { error: 'Origin not allowed', reason }),
                { status: 403, headers: baseHeaders }
            );
        }

        const clientId = RateLimitService.getClientId(req);
        const rateLimitResult = await RateLimitService.check(clientId, 100, 60 * 1000);

        if (!rateLimitResult.allowed) {
            return NextResponse.json(
                createSyncResponse(false, null, { error: 'Rate limit exceeded', retryAfter: rateLimitResult.resetAt }),
                {
                    status: 429,
                    headers: { ...baseHeaders, 'Retry-After': Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000).toString() }
                }
            );
        }

        let rawBody;
        try {
            rawBody = await req.json();
        } catch {
            return NextResponse.json(createSyncResponse(false, null, { message: 'Invalid JSON' }), { status: 400, headers: baseHeaders });
        }

        const {
            s: site_id, u: url, sid: client_sid, sm: session_month,
            ec: event_category, ea: event_action, el: event_label, ev: event_value,
            meta, r: referrer
        } = rawBody;

        if (!site_id || !url) {
            return NextResponse.json(createSyncResponse(true, 0, { status: 'skipped_missing_id' }), { headers: baseHeaders });
        }

        // --- 2. Domain Validation Layer ---
        // Site Validation
        const { valid: siteValid, site, error: siteError } = await SiteService.validateSite(site_id);
        if (!siteValid || !site) {
            return NextResponse.json(createSyncResponse(false, 0, { message: siteError }), { status: 404, headers: baseHeaders });
        }

        // URL Validation
        try { new URL(url); } catch {
            return NextResponse.json(createSyncResponse(false, null, { message: 'Invalid url format' }), { status: 400, headers: baseHeaders });
        }

        // --- 3. Context & Attribution Layer ---
        const urlObj = new URL(url);
        const params = urlObj.searchParams;
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '0.0.0.0';
        const userAgent = req.headers.get('user-agent') || 'Unknown';
        const geoInfo = extractGeoInfo(req, userAgent, meta).geoInfo;
        const deviceInfo = extractGeoInfo(req, userAgent, meta).deviceInfo;

        const currentGclid = params.get('gclid') || meta?.gclid;
        const fingerprint = meta?.fp || null;
        const dbMonth = session_month || new Date().toISOString().slice(0, 7) + '-01';

        // Resolve Attribution
        const { attribution, utm } = await AttributionService.resolveAttribution(currentGclid, fingerprint, url, referrer);

        const attributionSource = attribution.source;
        const deviceType = (utm?.device && /^(mobile|desktop|tablet)$/i.test(utm.device))
            ? utm.device.toLowerCase()
            : deviceInfo.device_type;

        // --- 4. Session Layer ---
        const session = await SessionService.handleSession(
            site.id,
            dbMonth,
            {
                client_sid, url, currentGclid, meta, params,
                attributionSource, deviceType, fingerprint, utm
            },
            { ip, userAgent, geoInfo, deviceInfo }
        );

        // --- 5. Event & Scoring Layer ---
        let summary = 'Standard Traffic';
        if (attributionSource.includes('Ads')) summary = 'Ads Origin';

        const { leadScore } = await EventService.createEvent({
            session: { id: session.id, created_month: session.created_month },
            siteId: site.id,
            url, event_category, event_action, event_label, event_value,
            meta, referrer, currentGclid, attributionSource, summary,
            fingerprint, ip, userAgent, geoInfo, deviceInfo, client_sid
        });

        // Update session metadata (duration, exit page) via Service method
        if (event_action === 'heartbeat' || event_action === 'session_end') {
            await EventService.updateSessionStats(session.id, session.created_month, event_action, meta);
        }

        // --- 6. Intent Layer (Click-to-Call / WhatsApp) ---
        await IntentService.handleIntent(
            site.id,
            { id: session.id },
            { fingerprint, event_action, event_label, meta, url, currentGclid, params },
            leadScore
        );

        return NextResponse.json(
            createSyncResponse(true, leadScore, { status: 'synced', sid: session.id }),
            { headers: baseHeaders }
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(errorMessage, { request_id: requestId, route: '/api/sync' });
        Sentry.captureException(error);

        return NextResponse.json(
            createSyncResponse(false, null, { error: 'Internal server error' }),
            { status: 500, headers: { 'Vary': 'Origin' } }
        );
    }
}
