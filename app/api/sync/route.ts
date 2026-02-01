import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { RateLimitService } from '@/lib/services/RateLimitService';
import { isOriginAllowed, parseAllowedOrigins } from '@/lib/cors';
import { createSyncResponse } from '@/lib/sync-utils';
import { logError } from '@/lib/log';
import { Client } from '@upstash/qstash';

export const runtime = 'nodejs';

const OPSMANTIK_VERSION = '2.1.0-upstash';
const qstash = new Client({ token: process.env.QSTASH_TOKEN || '' });
const ALLOWED_ORIGINS = parseAllowedOrigins();

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get('origin');
    const { isAllowed } = isOriginAllowed(origin, ALLOWED_ORIGINS);

    const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OpsMantik-Version',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
        'X-OpsMantik-Version': OPSMANTIK_VERSION,
    };

    if (isAllowed && origin) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
    }

    return new NextResponse(null, { status: isAllowed ? 200 : 403, headers });
}

export async function POST(req: NextRequest) {
    const origin = req.headers.get('origin');
    const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

    const baseHeaders: Record<string, string> = {
        'Vary': 'Origin',
        'X-OpsMantik-Version': OPSMANTIK_VERSION,
    };

    if (isAllowed && origin) {
        baseHeaders['Access-Control-Allow-Origin'] = origin;
        baseHeaders['Access-Control-Allow-Credentials'] = 'true';
    }

    if (!isAllowed) {
        return NextResponse.json(createSyncResponse(false, null, { error: 'Origin not allowed', reason }), { status: 403, headers: baseHeaders });
    }

    // --- 1. Rate Limit (Redis Based) ---
    const clientId = RateLimitService.getClientId(req);
    const rl = await RateLimitService.check(clientId, 100, 60000);
    if (!rl.allowed) {
        return NextResponse.json(createSyncResponse(false, null, { error: 'Rate limit' }), { status: 429, headers: baseHeaders });
    }

    // --- 2. Request Validation ---
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

    if (!body.s || (!body.url && !body.u)) {
        return NextResponse.json(createSyncResponse(true, 0, { status: 'skipped' }), { headers: baseHeaders });
    }

    // --- 3. Offload to QStash ---
    // Extract headers needed for background processing (producer has client req; worker does not)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
    const ua = req.headers.get('user-agent') || 'Unknown';
    const { extractGeoInfo } = await import('@/lib/geo');
    const { geoInfo } = extractGeoInfo(req, ua, body.meta);
    const ingestId = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    Sentry.setTag('ingest_id', ingestId);
    Sentry.setContext('sync_producer', {
        ingest_id: ingestId,
        site_id: body.s,
        url: body.url?.slice?.(0, 200) ?? null,
    });

    try {
        const workerUrl = `${new URL(req.url).origin}/api/sync/worker`;

        await qstash.publishJSON({
            url: workerUrl,
            body: {
                ...body,
                ingest_id: ingestId,
                ip,
                ua,
                isp_asn: geoInfo.isp_asn ?? undefined,
                is_proxy_detected: geoInfo.is_proxy_detected ?? undefined,
            },
            // High reliability retries (3 times)
            retries: 3,
        });

        // 200 response sent in < 50ms
        return NextResponse.json(
            createSyncResponse(true, 10, { status: 'queued', v: OPSMANTIK_VERSION, ingest_id: ingestId }),
            { headers: baseHeaders }
        );
    } catch (err) {
        logError('QSTASH_PUBLISH_ERROR', {
            route: 'sync',
            ingest_id: ingestId,
            site_id: body.s,
            error: String((err as Error)?.message ?? err),
        });
        Sentry.captureException(err);
        // Fallback: If QStash fails, we still return 200 to client to not break their page, but log the loss.
        return NextResponse.json(createSyncResponse(true, 0, { status: 'degraded', ingest_id: ingestId }), { headers: baseHeaders });
    }
}
