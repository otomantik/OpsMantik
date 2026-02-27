import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { adminClient } from '@/lib/supabase/admin';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { SiteService } from '@/lib/services/site-service';
import { getIngestCorsHeaders } from '@/lib/security/cors';
import { createSyncResponse } from '@/lib/sync-utils';
import { logError } from '@/lib/logging/logger';
import { buildFallbackRow } from '@/lib/sync-fallback';
import { getClientIp } from '@/lib/request-client-ip';
import { getFinalUrl, normalizeIp, normalizeUserAgent, parseValidIngestPayload } from '@/lib/types/ingest';
import { computeIdempotencyKey, computeIdempotencyKeyV2, getServerNowMs } from '@/lib/idempotency';
import { incrementBillingIngestRateLimited, incrementBillingIngestDegraded } from '@/lib/billing-metrics';
import { publishToQStash } from '@/lib/ingest/publish';

/**
 * 202 Accepted Async Ingest: Auth → Parse → validateSite → Rate limit → Consent → Publish to QStash → 202.
 * Heavy logic (idempotency, quota, entitlements, session/event) runs in /api/workers/ingest.
 */
export const runtime = 'nodejs';

const ERROR_MESSAGE_MAX_LEN = 500;

const OPSMANTIK_VERSION = '2.1.0-upstash';

/** Default req/min per site:clientId. Env OPSMANTIK_SYNC_RL_DEFAULT overrides (e.g. 5000). High default so normal traffic does not hit 429. */
const DEFAULT_RL_LIMIT =
  typeof process.env.OPSMANTIK_SYNC_RL_DEFAULT !== 'undefined' && process.env.OPSMANTIK_SYNC_RL_DEFAULT !== ''
    ? Math.max(500, parseInt(process.env.OPSMANTIK_SYNC_RL_DEFAULT, 10) || 2000)
    : 2000;
const RL_WINDOW_MS = 60000;

/** Max events per batch request. Batch support removes 400 batch_not_supported and reduces request count (fewer 429). */
const MAX_BATCH_SIZE = 50;

/** Parse OPSMANTIK_SYNC_RL_SITE_OVERRIDE e.g. "siteId1:5000,siteId2:3000" → Map(siteId -> limit). Optional per-site override. */
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
    const headers = getIngestCorsHeaders(origin, { 'X-OpsMantik-Version': OPSMANTIK_VERSION });
    const res = new NextResponse(null, { status: 200, headers });
    // Force credentials header on Response so it is not stripped (preflight requires it when request uses credentials).
    if (origin) {
        res.headers.set('Access-Control-Allow-Credentials', 'true');
    }
    return res;
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

/** Optional deps for tests: inject to assert no publish/fallback on failure. */
export type SyncHandlerDeps = {
  /** When set, used instead of SiteService.validateSite (for tests without real site). */
  validateSite?: (publicId: string) => Promise<{ valid: boolean; site?: { id: string } }>;
  /** When set, used instead of publishToQStash (for fallback tests: throw to trigger fallback). */
  publish?: (args: { url: string; body: unknown; deduplicationId: string; retries: number }) => Promise<void>;
  /** When set, used instead of fallback buffer insert (for assertions). */
  insertFallback?: (row: unknown) => Promise<{ error: unknown }>;
  /** When set, used instead of RateLimitService.check (for tests: avoid 429). */
  checkRateLimit?: () => Promise<{ allowed: boolean; resetAt?: number }>;
};

/**
 * Factory for POST handler. 202 Accepted async ingest.
 * Validates, publishes to QStash (/api/workers/ingest), returns 202.
 */
export function createSyncHandler(deps?: SyncHandlerDeps) {
  return async function POST(req: NextRequest) {
    const origin = req.headers.get('origin');
    const baseHeaders: Record<string, string> = {
        ...getBuildInfoHeaders(),
        ...getIngestCorsHeaders(origin, { 'X-OpsMantik-Version': OPSMANTIK_VERSION }),
    };

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
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: { ...baseHeaders, 'X-OpsMantik-Error-Code': 'invalid_json' } });
    }

    // --- 1.5 Normalize to array: single payload or { events: [ ... ] }. Batch supported (no more 400 batch_not_supported).
    let rawBodies: unknown[];
    if (typeof json === 'object' && json !== null && Array.isArray((json as Record<string, unknown>).events)) {
        const events = (json as Record<string, unknown>).events as unknown[];
        if (events.length === 0) {
            return NextResponse.json(
                { ok: false, error: 'invalid_payload', code: 'events_empty' },
                { status: 400, headers: { ...baseHeaders, 'X-OpsMantik-Error-Code': 'events_empty' } }
            );
        }
        rawBodies = events.slice(0, MAX_BATCH_SIZE);
    } else {
        rawBodies = [json];
    }

    // --- 2. Validate all payloads and require same site_id ---
    type ValidIngestPayload = import('@/lib/types/ingest').ValidIngestPayload;
    const bodies: ValidIngestPayload[] = [];
    for (let i = 0; i < rawBodies.length; i++) {
        const parsed = parseValidIngestPayload(rawBodies[i]);
        if (parsed.kind === 'invalid') {
            return NextResponse.json(
                { ok: false, error: 'invalid_payload', code: parsed.error },
                { status: 400, headers: { ...baseHeaders, 'X-OpsMantik-Error-Code': parsed.error } }
            );
        }
        bodies.push(parsed.data);
    }
    const firstSiteId = bodies[0].s;
    for (let i = 1; i < bodies.length; i++) {
        if (bodies[i].s !== firstSiteId) {
            return NextResponse.json(
                { ok: false, error: 'invalid_payload', code: 'batch_mixed_sites' },
                { status: 400, headers: { ...baseHeaders, 'X-OpsMantik-Error-Code': 'batch_mixed_sites' } }
            );
        }
    }
    const body = bodies[0];

    // --- 3. Site validation (MUST run before consent). Site invalid → 400/403, NOT 204. ---
    const validateSiteFn = deps?.validateSite ?? SiteService.validateSite;
    const { valid: siteValid, site } = await validateSiteFn(body.s);
    if (!siteValid || !site) {
        return NextResponse.json(
            createSyncResponse(false, null, { error: 'Site not found or invalid', code: 'site_not_found' }),
            { status: 400, headers: { ...baseHeaders, 'X-OpsMantik-Error-Code': 'site_not_found' } }
        );
    }
    const siteIdUuid = site.id;

    // --- 4. Rate Limit (abuse/DoS). One check per request (batch counts as one). ---
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
        return NextResponse.json(createSyncResponse(false, null, { error: 'Rate limit' }), { status: 429, headers: { ...baseHeaders, 'x-opsmantik-ratelimit': '1', 'Retry-After': String(retryAfterSec) } });
    }

    // COMPLIANCE INVARIANT — validateSite → consent → publish (idempotency/quota run in worker). Return 204 without publish when analytics consent missing.
    if (bodies.length === 1) {
        const singleConsentScopes = Array.isArray((body as Record<string, unknown>).consent_scopes)
            ? ((body as Record<string, unknown>).consent_scopes as string[]).map((s) => String(s).toLowerCase())
            : Array.isArray(body.meta?.consent_scopes)
                ? (body.meta.consent_scopes as string[]).map((s) => String(s).toLowerCase())
                : [];
        if (!singleConsentScopes.includes('analytics')) {
            const consentHeaders = { ...baseHeaders, 'x-opsmantik-consent-missing': 'analytics' };
            return new NextResponse(null, { status: 204, headers: consentHeaders });
        }
    }

    const workerUrl = `${new URL(req.url).origin}/api/workers/ingest`;
    const doInsertFallback = deps?.insertFallback ?? (async (row: unknown) => {
      const { error } = await adminClient.from('ingest_fallback_buffer').insert(row as Record<string, unknown>);
      return { error };
    });

    // Real client IP: x-forwarded-for (first) then x-real-ip (multi-tenant/proxy e.g. SST)
    const clientIp = getClientIp(req);
    const ip = normalizeIp(clientIp);
    const ua = normalizeUserAgent(req.headers.get('user-agent'));
    const { extractGeoInfo } = await import('@/lib/geo');

    const idempotencyVersion = process.env.OPSMANTIK_IDEMPOTENCY_VERSION === '2' ? '2' : '1';
    const doPublish = deps?.publish ?? (async (args: { url: string; body: unknown; deduplicationId: string; retries: number }) => {
      await publishToQStash({ url: args.url, body: args.body as Record<string, unknown>, deduplicationId: args.deduplicationId, retries: args.retries });
    });

    let queued = 0;
    let degraded = 0;
    const ingestIds: string[] = [];

    for (const b of bodies) {
      const consentScopes = Array.isArray((b as Record<string, unknown>).consent_scopes)
        ? ((b as Record<string, unknown>).consent_scopes as string[]).map((s) => String(s).toLowerCase())
        : Array.isArray(b.meta?.consent_scopes)
          ? (b.meta.consent_scopes as string[]).map((s) => String(s).toLowerCase())
          : [];
      if (!consentScopes.includes('analytics')) continue;

      const { geoInfo } = extractGeoInfo(req, ua, b.meta);
      const ingestId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      ingestIds.push(ingestId);
      Sentry.setTag('ingest_id', ingestId);
      Sentry.setContext('sync_producer', { ingest_id: ingestId, site_id: b.s, url: getFinalUrl(b).slice(0, 200) });

      const workerPayload = {
        ...b,
        consent_scopes: consentScopes,
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

      const idempotencyKey =
        idempotencyVersion === '2'
          ? await computeIdempotencyKeyV2(siteIdUuid, b, getServerNowMs())
          : await computeIdempotencyKey(siteIdUuid, b);

      try {
        await doPublish({ url: workerUrl, body: workerPayload, deduplicationId: idempotencyKey, retries: 3 });
        queued++;
      } catch (err) {
        const errorMessage = String((err as Error)?.message ?? err);
        const errorShort = errorMessage.slice(0, ERROR_MESSAGE_MAX_LEN);
        logError('QSTASH_PUBLISH_FAILED', { code: 'QSTASH_PUBLISH_FAILED', route: 'sync', ingest_id: ingestId, site_id: b.s, error: errorMessage });
        Sentry.captureException(err);
        try {
          await adminClient.from('ingest_publish_failures').insert({
            site_public_id: b.s,
            error_code: 'QSTASH_PUBLISH_FAILED',
            error_message_short: errorShort || null,
          });
        } catch { /* ignore */ }
        try {
          await doInsertFallback(buildFallbackRow(siteIdUuid, workerPayload, errorShort || null));
        } catch (fallbackErr) {
          logError('INGEST_FALLBACK_INSERT_FAILED', { route: 'sync', ingest_id: ingestId, site_id: b.s, error: String(fallbackErr) });
        }
        incrementBillingIngestDegraded();
        degraded++;
      }
    }

    const primaryIngestId = ingestIds[0];
    // RPO: When both QStash and fallback fail, return 503 so client retries (event stays in outbox).
    if (degraded > 0 && queued === 0) {
      return NextResponse.json(
        createSyncResponse(false, 0, { status: 'degraded', error: 'Ingest temporarily unavailable', ingest_id: primaryIngestId }),
        { status: 503, headers: { ...baseHeaders, 'x-opsmantik-degraded': 'qstash_publish_failed', 'x-opsmantik-fallback': 'true', 'Retry-After': '60' } }
      );
    }

    return NextResponse.json(
      createSyncResponse(true, 10, { status: 'queued', v: OPSMANTIK_VERSION, ingest_id: primaryIngestId, count: queued, degraded }),
      { status: 202, headers: baseHeaders }
    );
  };
}

/** Default POST handler (production). */
export const POST = createSyncHandler();
