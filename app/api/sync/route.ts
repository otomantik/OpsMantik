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
import { getCurrentYearMonthUTC, getSitePlan, getUsage, evaluateQuota, computeRetryAfterToMonthRollover, incrementUsageRedis, type QuotaDecision } from '@/lib/quota';
import { buildFallbackRow } from '@/lib/sync-fallback';
import { getFinalUrl, normalizeIp, normalizeUserAgent, parseValidIngestPayload } from '@/lib/types/ingest';
import { classifyIngestBillable } from '@/lib/billing/ingest-billable';
import {
    incrementBillingIngestAllowed,
    incrementBillingIngestDuplicate,
    incrementBillingIngestRejectedQuota,
    incrementBillingIngestRateLimited,
    incrementBillingIngestOverage,
    incrementBillingIngestDegraded,
} from '@/lib/billing-metrics';

/**
 * Revenue Kernel (frozen order): Auth → Rate limit → Idempotency → Quota → Publish.
 * Invoice authority: Postgres ingest_idempotency ONLY. Rate limit 429 = no idempotency row; Quota 429 = row inserted then billable=false.
 */
export const runtime = 'nodejs';

const ERROR_MESSAGE_MAX_LEN = 500;

const OPSMANTIK_VERSION = '2.1.0-upstash';
const ALLOWED_ORIGINS = parseAllowedOrigins();

/** 100/min was too low for sites with 40–50 intents/day burst; 300/min reduces 429s while still limiting abuse. Use OPSMANTIK_SYNC_RL_SITE_OVERRIDE for specific sites if needed. */
const DEFAULT_RL_LIMIT = 300;
const RL_WINDOW_MS = 60000;

/** Parse OPSMANTIK_SYNC_RL_SITE_OVERRIDE e.g. "siteId1:500,siteId2:300" → Map(siteId -> limit). Temporary relief for a site hitting 429. */
function getSiteRateLimitOverrides(): Map<string, number> {
  const raw = process.env.OPSMANTIK_SYNC_RL_SITE_OVERRIDE;
  if (!raw || typeof raw !== 'string') return new Map();
  const map = new Map<string, number>();
  for (const part of raw.split(',')) {
    const [siteId, limitStr] = part.trim().split(':');
    if (siteId && limitStr) {
      const limit = parseInt(limitStr, 10);
      if (Number.isInteger(limit) && limit > 0) map.set(siteId.trim(), limit);
    }
  }
  return map;
}

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

/**
 * Extract siteId from raw sync body for rate-limit key (no DB).
 * Single payload: body.s. Batch: events[0].s. Returns null if missing/invalid.
 */
export function extractSiteIdForRateLimit(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const rec = json as Record<string, unknown>;
  const s = rec.s;
  if (typeof s === 'string') {
    const t = s.trim();
    return t.length > 0 ? t : null;
  }
  const events = rec.events;
  if (Array.isArray(events) && events.length > 0) {
    const first = events[0];
    if (typeof first === 'object' && first !== null && typeof (first as Record<string, unknown>).s === 'string') {
      const t = ((first as Record<string, unknown>).s as string).trim();
      return t.length > 0 ? t : null;
    }
  }
  return null;
}

/** Optional deps for tests: inject to assert no publish/fallback/redis on gate failure, or to force quota/fallback paths. */
export type SyncHandlerDeps = {
  tryInsert?: (siteIdUuid: string, idempotencyKey: string) => Promise<TryInsertIdempotencyResult>;
  /** When set, used instead of SiteService.validateSite (for tests without real site). */
  validateSite?: (publicId: string) => Promise<{ valid: boolean; site?: { id: string } }>;
  /** When set, used instead of getSitePlan + getUsage + evaluateQuota (for quota-reject tests). */
  getQuotaDecision?: (siteIdUuid: string, yearMonth: string) => Promise<QuotaDecision>;
  /** When set, used instead of updateIdempotencyBillableFalse (for assertions). */
  updateIdempotencyBillableFalse?: (siteIdUuid: string, idempotencyKey: string) => Promise<{ updated?: boolean }>;
  /** When set, used instead of QStash publish (for fallback tests: throw to trigger fallback). */
  publish?: (args: { url: string; body: unknown; retries: number }) => Promise<void>;
  /** When set, used instead of fallback buffer insert (for assertions). */
  insertFallback?: (row: unknown) => Promise<{ error: unknown }>;
  /** When set, used instead of incrementUsageRedis (for assertions: not called on db down). */
  incrementUsageRedis?: (siteIdUuid: string, yearMonth: string) => Promise<void>;
  /** When set, used instead of RateLimitService.check (for tests: avoid 429). */
  checkRateLimit?: () => Promise<{ allowed: boolean; resetAt?: number }>;
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

    if (origin) {
        baseHeaders['Access-Control-Allow-Origin'] = origin;
        if (isAllowed) baseHeaders['Access-Control-Allow-Credentials'] = 'true';
    }

    if (!isAllowed) {
        return NextResponse.json(createSyncResponse(false, null, { error: 'Origin not allowed', reason }), { status: 403, headers: baseHeaders });
    }

    const contentLength = req.headers.get('content-length');
    if (contentLength !== null && contentLength !== undefined) {
        const len = parseInt(contentLength, 10);
        if (!Number.isNaN(len) && len > 256 * 1024) {
            return NextResponse.json(createSyncResponse(false, null, { error: 'Payload too large' }), { status: 413, headers: baseHeaders });
        }
    }

    // --- 1. Parse body once (needed for site-scoped rate limit key and later validation) ---
    let json: unknown;
    try {
        json = await req.json();
    } catch {
        const clientId = RateLimitService.getClientId(req);
        const rl = deps?.checkRateLimit
            ? await deps.checkRateLimit()
            : await RateLimitService.check(clientId, 100, 60000);
        if (!rl.allowed) {
            incrementBillingIngestRateLimited();
            const retryAfterSec = rl.resetAt != null ? Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) : 60;
            return NextResponse.json(createSyncResponse(false, null, { error: 'Rate limit' }), { status: 429, headers: { ...baseHeaders, 'x-opsmantik-ratelimit': '1', 'Retry-After': String(retryAfterSec) } });
        }
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: baseHeaders });
    }

    // --- 2. Rate Limit (abuse/DoS). Key = siteId:clientId when siteId present, else clientId. 429 = non-billable. ---
    const siteIdForRl = extractSiteIdForRateLimit(json);
    const clientId = RateLimitService.getClientId(req);
    const rateLimitKey = siteIdForRl ? `${siteIdForRl}:${clientId}` : clientId;
    const limitOverrides = getSiteRateLimitOverrides();
    const rlLimit = (siteIdForRl && limitOverrides.has(siteIdForRl)) ? limitOverrides.get(siteIdForRl)! : DEFAULT_RL_LIMIT;
    const rl = deps?.checkRateLimit
        ? await deps.checkRateLimit()
        : await RateLimitService.check(rateLimitKey, rlLimit, RL_WINDOW_MS);
    if (!rl.allowed) {
        incrementBillingIngestRateLimited();
        const retryAfterSec = rl.resetAt != null ? Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) : 60;
        const rateLimitHeaders = { ...baseHeaders, 'x-opsmantik-ratelimit': '1', 'Retry-After': String(retryAfterSec) };
        return NextResponse.json(createSyncResponse(false, null, { error: 'Rate limit' }), { status: 429, headers: rateLimitHeaders });
    }

    // --- 3. Request Validation ---
    const parsed = parseValidIngestPayload(json);
    if (parsed.kind === 'invalid') {
        // IMPORTANT: Always include CORS headers, otherwise browsers surface this as a CORS error.
        return NextResponse.json(
            { ok: false, error: 'invalid_payload' },
            { status: 400, headers: baseHeaders }
        );
    }
    const body = parsed.data;

    // --- 2.5 Site resolution (required for idempotency + fallback site_id) ---
    const validateSiteFn = deps?.validateSite ?? SiteService.validateSite;
    const { valid: siteValid, site } = await validateSiteFn(body.s);
    if (!siteValid || !site) {
        return NextResponse.json(createSyncResponse(false, null, { error: 'Site not found or invalid' }), { status: 400, headers: baseHeaders });
    }
    const siteIdUuid = site.id;

    // --- 2.6 Idempotency (gatekeeper). Fail-secure: billable = successfully inserted row only. ---
    const billableDecision = classifyIngestBillable(body);
    const idempotencyVersion = process.env.OPSMANTIK_IDEMPOTENCY_VERSION === '2' ? '2' : '1';
    const idempotencyKey = idempotencyVersion === '2'
      ? await computeIdempotencyKeyV2(siteIdUuid, body, getServerNowMs())
      : await computeIdempotencyKey(siteIdUuid, body);
    const idempotencyResult = await tryInsert(siteIdUuid, idempotencyKey, {
      billable: billableDecision.billable,
      billingReason: billableDecision.reason,
      eventCategory: (body as any).ec,
      eventAction: (body as any).ea,
      eventLabel: (body as any).el,
    });

    if (idempotencyResult.error && !idempotencyResult.duplicate) {
        logError('BILLING_GATE_CLOSED', { route: 'sync', site_id: body.s, error: String(idempotencyResult.error) });
        return NextResponse.json(
            { status: 'billing_gate_closed' },
            { status: 500, headers: baseHeaders }
        );
    }

    if (idempotencyResult.duplicate) {
        if (billableDecision.billable) incrementBillingIngestDuplicate();
        const dedupHeaders = { ...baseHeaders, 'x-opsmantik-dedup': '1' };
        return NextResponse.json(
            createSyncResponse(true, 10, { status: 'duplicate', captured: true, v: OPSMANTIK_VERSION }),
            { headers: dedupHeaders }
        );
    }

    const idempotencyInserted = idempotencyResult.inserted;

    // --- 2.7 Quota (PR-3). After idempotency insert success, before publish. Reject → 429, billable=false; overage → header + billing_state. ---
    const yearMonth = getCurrentYearMonthUTC();
    const updateBillableFalse = deps?.updateIdempotencyBillableFalse ?? updateIdempotencyBillableFalse;
    if (idempotencyInserted && billableDecision.billable) {
        let decision: QuotaDecision;
        if (deps?.getQuotaDecision) {
            decision = await deps.getQuotaDecision(siteIdUuid, yearMonth);
        } else {
            const plan = await getSitePlan(siteIdUuid);
            const { usage, source: usageSource } = await getUsage(siteIdUuid, yearMonth);
            const usageAfterThis = usage + 1;
            decision = evaluateQuota(plan, usageAfterThis);
            if (usageSource !== 'redis' && usageAfterThis >= plan.monthly_limit * 0.95) {
                baseHeaders['x-opsmantik-degraded'] = 'quota_pg_conservative';
            }
        }

        if (decision.reject) {
            incrementBillingIngestRejectedQuota();
            await updateBillableFalse(siteIdUuid, idempotencyKey, { reason: 'rejected_quota' });
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

    const doPublish = deps?.publish ?? (async (args: { url: string; body: unknown; retries: number }) => {
        await qstash.publishJSON({ url: args.url, body: args.body, retries: args.retries });
    });
    const doInsertFallback = deps?.insertFallback ?? (async (row: unknown) => {
        const { error } = await adminClient.from('ingest_fallback_buffer').insert(row as Record<string, unknown>);
        return { error };
    });
    const doIncrementRedis = deps?.incrementUsageRedis ?? incrementUsageRedis;

    try {
        const workerUrl = `${new URL(req.url).origin}/api/sync/worker`;
        await doPublish({ url: workerUrl, body: workerPayload, retries: 3 });
        if (idempotencyInserted && billableDecision.billable) {
            await doIncrementRedis(siteIdUuid, yearMonth);
            incrementBillingIngestAllowed();
            if (baseHeaders['x-opsmantik-overage']) incrementBillingIngestOverage();
        }
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
            await doInsertFallback(buildFallbackRow(siteIdUuid, workerPayload, errorShort || null));
            if (idempotencyInserted && billableDecision.billable) await doIncrementRedis(siteIdUuid, yearMonth);
        } catch (fallbackErr) {
            logError('INGEST_FALLBACK_INSERT_FAILED', {
                route: 'sync',
                ingest_id: ingestId,
                site_id: body.s,
                error: String(fallbackErr),
            });
        }

        incrementBillingIngestDegraded();
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
