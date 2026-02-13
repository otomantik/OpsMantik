import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { adminClient } from '@/lib/supabase/admin';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { SiteService } from '@/lib/services/site-service';
import { isOriginAllowed, parseAllowedOrigins } from '@/lib/security/cors';
import { createSyncResponse } from '@/lib/sync-utils';
import { logError } from '@/lib/logging/logger';
import { qstash } from '@/lib/qstash/client';
import { computeIdempotencyKey, computeIdempotencyKeyV2, getServerNowMs, tryInsertIdempotencyKey, updateIdempotencyBillableFalse, setOverageOnIdempotencyRow, type TryInsertIdempotencyResult } from '@/lib/idempotency';
import { getCurrentYearMonthUTC, getSitePlan, getUsage, evaluateQuota, computeRetryAfterToMonthRollover, incrementUsageRedis } from '@/lib/quota';
import { buildFallbackRow } from '@/lib/sync-fallback';
import { getFinalUrl, normalizeIp, normalizeUserAgent, parseValidIngestPayload } from '@/lib/types/ingest';

/**
 * Revenue Kernel (frozen order): Auth → Rate limit → Idempotency → Quota → Publish.
 * Invoice authority: Postgres ingest_idempotency ONLY. Rate limit 429 = no idempotency row; Quota 429 = row inserted then billable=false.
 */
export const runtime = 'nodejs';

const ERROR_MESSAGE_MAX_LEN = 500;

const OPSMANTIK_VERSION = '2.1.0-upstash';
const ALLOWED_ORIGINS = parseAllowedOrigins();

export async function GET(req: NextRequest) {
    // NOTE: /api/sync is designed for POST ingestion. A browser-open GET should return 405.
    // For production debugging of Cloudflare vs Vercel geo headers, we expose an explicit
    // diagnostic mode that does NOT reveal client IP.
    //
    // Usage after deploy: https://console.opsmantik.com/api/sync?diag=1
    const url = new URL(req.url);
    if (url.searchParams.get('diag') !== '1') {
        return NextResponse.json(
            { error: 'Method not allowed. Use POST.', diag: 'Add ?diag=1 for header diagnostics.' },
            { status: 405, headers: { ...getBuildInfoHeaders(), 'Allow': 'POST, OPTIONS' } }
        );
    }

    const ua = req.headers.get('user-agent') || 'Unknown';
    const { extractGeoInfo } = await import('@/lib/geo');
    const { geoInfo } = extractGeoInfo(req, ua, undefined);

    const cf = {
        city: req.headers.get('cf-ipcity'),
        district: req.headers.get('cf-ipdistrict'),
        country: req.headers.get('cf-ipcountry'),
        timezone: req.headers.get('cf-timezone'),
        asn: req.headers.get('cf-connecting-ip-asn'),
        org: req.headers.get('cf-as-organization'),
        ray: req.headers.get('cf-ray'),
    };
    const vercel = {
        city: req.headers.get('x-vercel-ip-city'),
        country: req.headers.get('x-vercel-ip-country'),
        asn: req.headers.get('x-vercel-ip-asn'),
        id: req.headers.get('x-vercel-id'),
    };

    const headersPresent = {
        cf_ipcity: Boolean(cf.city),
        cf_ipdistrict: Boolean(cf.district),
        cf_ipcountry: Boolean(cf.country),
        x_vercel_ip_city: Boolean(vercel.city),
        x_vercel_ip_country: Boolean(vercel.country),
    };

    return NextResponse.json(
        {
            ok: true,
            v: OPSMANTIK_VERSION,
            headers_present: headersPresent,
            chosen: {
                city: geoInfo.city,
                district: geoInfo.district,
                country: geoInfo.country,
                timezone: geoInfo.timezone,
            },
            cf,
            vercel,
        },
        { headers: { ...getBuildInfoHeaders(), 'Cache-Control': 'no-store' } }
    );
}

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

export type SyncHandlerDeps = {
  tryInsert?: (siteIdUuid: string, idempotencyKey: string) => Promise<TryInsertIdempotencyResult>;
};

/**
 * Factory for POST handler. Production uses createSyncHandler() with no deps.
 * Tests inject tryInsert to simulate DB failures without global state.
 */
export function createSyncHandler(deps?: SyncHandlerDeps) {
  const tryInsert = deps?.tryInsert ?? tryInsertIdempotencyKey;

  return async function POST(req: NextRequest) {
    const origin = req.headers.get('origin');
    const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

    const baseHeaders: Record<string, string> = {
        ...getBuildInfoHeaders(),
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

    // --- 1. Rate Limit (abuse/DoS). Order: Auth → Rate limit → Idempotency → Publish. 429 = non-billable. ---
    const clientId = RateLimitService.getClientId(req);
    const rl = await RateLimitService.check(clientId, 100, 60000);
    if (!rl.allowed) {
        const rateLimitHeaders = { ...baseHeaders, 'x-opsmantik-ratelimit': '1' };
        return NextResponse.json(createSyncResponse(false, null, { error: 'Rate limit' }), { status: 429, headers: rateLimitHeaders });
    }

    // --- 2. Request Validation ---
    let json: unknown;
    try { json = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400, headers: getBuildInfoHeaders() }); }

    const parsed = parseValidIngestPayload(json);
    if (parsed.kind === 'invalid') return NextResponse.json({ ok: false }, { status: 400, headers: getBuildInfoHeaders() });
    const body = parsed.data;

    // --- 2.5 Site resolution (required for idempotency + fallback site_id) ---
    const { valid: siteValid, site } = await SiteService.validateSite(body.s);
    if (!siteValid || !site) {
        return NextResponse.json(createSyncResponse(false, null, { error: 'Site not found or invalid' }), { status: 400, headers: baseHeaders });
    }
    const siteIdUuid = site.id;

    // --- 2.6 Idempotency (gatekeeper). Fail-secure: billable = successfully inserted row only. ---
    const idempotencyVersion = process.env.OPSMANTIK_IDEMPOTENCY_VERSION === '2' ? '2' : '1';
    const idempotencyKey = idempotencyVersion === '2'
      ? await computeIdempotencyKeyV2(siteIdUuid, body, getServerNowMs())
      : await computeIdempotencyKey(siteIdUuid, body);
    const idempotencyResult = await tryInsert(siteIdUuid, idempotencyKey);

    if (idempotencyResult.error && !idempotencyResult.duplicate) {
        logError('BILLING_GATE_CLOSED', { route: 'sync', site_id: body.s, error: String(idempotencyResult.error) });
        return NextResponse.json(
            { status: 'billing_gate_closed' },
            { status: 500, headers: baseHeaders }
        );
    }

    if (idempotencyResult.duplicate) {
        const dedupHeaders = { ...baseHeaders, 'x-opsmantik-dedup': '1' };
        return NextResponse.json(
            createSyncResponse(true, 10, { status: 'duplicate', captured: true, v: OPSMANTIK_VERSION }),
            { headers: dedupHeaders }
        );
    }

    const idempotencyInserted = idempotencyResult.inserted;

    // --- 2.7 Quota (PR-3). After idempotency insert success, before publish. Reject → 429, billable=false; overage → header + billing_state. ---
    const yearMonth = getCurrentYearMonthUTC();
    if (idempotencyInserted) {
        const plan = await getSitePlan(siteIdUuid);
        const { usage, source: usageSource } = await getUsage(siteIdUuid, yearMonth);
        // Usage from Redis is pre-increment; we're about to allow this request so effective usage for gating = usage + 1
        const usageAfterThis = usage + 1;
        const decision = evaluateQuota(plan, usageAfterThis);

        if (decision.reject) {
            await updateIdempotencyBillableFalse(siteIdUuid, idempotencyKey);
            const retryAfter = computeRetryAfterToMonthRollover();
            const quotaHeaders = {
                ...baseHeaders,
                ...decision.headers,
                'Retry-After': String(retryAfter),
            };
            return NextResponse.json(
                { status: 'rejected_quota' },
                { status: 429, headers: quotaHeaders }
            );
        }

        if (decision.overage) {
            await setOverageOnIdempotencyRow(siteIdUuid, idempotencyKey);
        }

        // Apply quota headers to successful response (set below before publish return)
        baseHeaders['x-opsmantik-quota-remaining'] = decision.headers['x-opsmantik-quota-remaining'];
        if (decision.headers['x-opsmantik-overage']) baseHeaders['x-opsmantik-overage'] = decision.headers['x-opsmantik-overage'];
        // When Redis is down and usage is close to limit, allow but mark degraded (pro tier choice)
        if (usageSource !== 'redis' && usageAfterThis >= plan.monthly_limit * 0.95) {
            baseHeaders['x-opsmantik-degraded'] = 'quota_pg_conservative';
        }
    }

    // --- 3. Offload to QStash (with server-side fallback on publish failure) ---
    const ip = normalizeIp(req.headers.get('x-forwarded-for'));
    const ua = normalizeUserAgent(req.headers.get('user-agent'));
    const { extractGeoInfo } = await import('@/lib/geo');
    const { geoInfo } = extractGeoInfo(req, ua, body.meta);
    const ingestId = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    Sentry.setTag('ingest_id', ingestId);
    Sentry.setContext('sync_producer', {
        ingest_id: ingestId,
        site_id: body.s,
        url: getFinalUrl(body).slice(0, 200),
    });

    const workerPayload = {
        ...body,
        ingest_id: ingestId,
        ip,
        ua,
        geo_city: geoInfo.city !== 'Unknown' ? geoInfo.city : undefined,
        geo_district: geoInfo.district ?? undefined,
        geo_country: geoInfo.country !== 'Unknown' ? geoInfo.country : undefined,
        geo_timezone: geoInfo.timezone !== 'Unknown' ? geoInfo.timezone : undefined,
        geo_telco_carrier: geoInfo.telco_carrier ?? undefined,
        isp_asn: geoInfo.isp_asn ?? undefined,
        is_proxy_detected: geoInfo.is_proxy_detected ?? undefined,
    };

    try {
        const workerUrl = `${new URL(req.url).origin}/api/sync/worker`;
        await qstash.publishJSON({
            url: workerUrl,
            body: workerPayload,
            retries: 3,
        });
        if (idempotencyInserted) await incrementUsageRedis(siteIdUuid, yearMonth);
        return NextResponse.json(
            createSyncResponse(true, 10, { status: 'queued', v: OPSMANTIK_VERSION, ingest_id: ingestId }),
            { headers: baseHeaders }
        );
    } catch (err) {
        const errorMessage = String((err as Error)?.message ?? err);
        const errorShort = errorMessage.slice(0, ERROR_MESSAGE_MAX_LEN);

        logError('QSTASH_PUBLISH_FAILED', {
            code: 'QSTASH_PUBLISH_FAILED',
            route: 'sync',
            ingest_id: ingestId,
            site_id: body.s,
            error: errorMessage,
        });
        Sentry.captureException(err);

        // Best-effort: observability + fallback buffer (zero data loss)
        try {
            await adminClient.from('ingest_publish_failures').insert({
                site_public_id: body.s,
                error_code: 'QSTASH_PUBLISH_FAILED',
                error_message_short: errorShort || null,
            });
        } catch {
            /* ignore */
        }

        try {
            await adminClient.from('ingest_fallback_buffer').insert(
                buildFallbackRow(siteIdUuid, workerPayload, errorShort || null)
            );
            if (idempotencyInserted) await incrementUsageRedis(siteIdUuid, yearMonth);
        } catch (fallbackErr) {
            logError('INGEST_FALLBACK_INSERT_FAILED', {
                route: 'sync',
                ingest_id: ingestId,
                site_id: body.s,
                error: String(fallbackErr),
            });
        }

        // 200 OK (degraded): we captured the data; client should not retry
        const degradedHeaders = {
            ...baseHeaders,
            'x-opsmantik-degraded': 'qstash_publish_failed',
            'x-opsmantik-fallback': 'true',
        };
        return NextResponse.json(
            createSyncResponse(true, 0, { status: 'degraded', ingest_id: ingestId }),
            { headers: degradedHeaders }
        );
    }
  };
}

/** Default POST handler (production). */
export const POST = createSyncHandler();
