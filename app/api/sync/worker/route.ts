/**
 * Sync worker: consumes QStash payloads (ingest events). Must only accept signed requests in production.
 *
 * Env (see lib/qstash/env.ts and lib/qstash/require-signature.ts):
 * - Production: QSTASH_TOKEN + QSTASH_CURRENT_SIGNING_KEY required; QSTASH_NEXT_SIGNING_KEY optional (rotation).
 * - Signature is always verified in prod; missing keys -> 503. Invalid/missing signature -> 403.
 * - Local bypass: NODE_ENV != production and ALLOW_INSECURE_DEV_WORKER=true only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { extractGeoInfo } from '@/lib/geo';
import * as Sentry from '@sentry/nextjs';
import { adminClient } from '@/lib/supabase/admin';
import { debugLog } from '@/lib/utils';
import { logError } from '@/lib/logging/logger';
import { assertQstashEnv } from '@/lib/qstash/env';
import { requireQstashSignature } from '@/lib/qstash/require-signature';
import { getFinalUrl, isRecord, parseValidWorkerJobData, type IngestMeta } from '@/lib/types/ingest';

export const runtime = 'nodejs';

// Services
import { SiteService } from '@/lib/services/site-service';
import { AttributionService } from '@/lib/services/attribution-service';
import { SessionService } from '@/lib/services/session-service';
import { EventService } from '@/lib/services/event-service';
import { IntentService } from '@/lib/services/intent-service';
import { incrementCapturedSafe } from '@/lib/sync/worker-stats';

// Fail-fast in production if QStash env is missing (500 on startup).
assertQstashEnv();

type ErrorLike = { code?: unknown; message?: unknown; status?: unknown };
function asErrorLike(err: unknown): ErrorLike {
    return isRecord(err) ? (err as ErrorLike) : {};
}
function getErrorMessage(err: unknown): string {
    if (err instanceof Error && typeof err.message === 'string') return err.message;
    const e = asErrorLike(err);
    if (typeof e.message === 'string') return e.message;
    return String(err);
}

function getQstashMessageId(req: NextRequest): string | null {
    return (
        req.headers.get('Upstash-Message-Id') ||
        req.headers.get('upstash-message-id') ||
        null
    );
}

async function sha256Hex(input: string): Promise<string> {
    // WebCrypto works in both Edge + Node runtimes (no Node 'crypto' import).
    const data = new TextEncoder().encode(input);
    const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function deterministicUuidFromString(input: string): Promise<string> {
    // We need a UUID to reuse the existing `public.processed_signals` ledger (UUID PK).
    // Use a stable SHA-256 hash and force UUIDv5-like version/variant bits.
    const hex = await sha256Hex(input); // 64 hex chars
    let raw = hex.slice(0, 32); // 128-bit

    // Set version nibble (index 12) to '5'
    raw = raw.slice(0, 12) + '5' + raw.slice(13);
    // Set variant nibble (index 16) to 'a' (10xx)
    raw = raw.slice(0, 16) + 'a' + raw.slice(17);

    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

function isUniqueViolation(err: unknown): boolean {
    const e = asErrorLike(err);
    const code = typeof e.code === 'string' ? e.code : undefined;
    const message = typeof e.message === 'string' ? e.message : '';
    return code === '23505' || /duplicate key value/i.test(message);
}

function isRetryableError(err: unknown): boolean {
    const e = asErrorLike(err);
    const message = typeof e.message === 'string' ? e.message : String(err);
    const code = typeof e.code === 'string' ? e.code : '';
    const status = typeof e.status === 'number' ? e.status : undefined;

    if (status && [408, 429, 500, 502, 503, 504].includes(status)) return true;
    if (/timeout|timed out|ETIMEDOUT|ECONNRESET|EPIPE|fetch failed|network|temporarily unavailable/i.test(message)) return true;
    if (/rate limit|too many requests/i.test(message)) return true;

    // Default Postgres: treat unique violations as non-retryable (handled separately)
    if (code === '23505') return false;

    return false;
}

async function handler(req: NextRequest) {
    let qstashMessageId: string | null = null;
    let dedupEventId: string | null = null;
    let siteDbId: string | null = null;
    let rawBody: unknown = null;

    try {
        qstashMessageId = getQstashMessageId(req);
        rawBody = await req.json();
        const parsed = parseValidWorkerJobData(rawBody);
        if (parsed.kind !== 'ok') return NextResponse.json({ ok: true });

        const job = parsed.data;
        const site_id = job.s;
        const client_sid = typeof job.sid === 'string' ? job.sid : '';
        const session_month = typeof job.sm === 'string' ? job.sm : '';
        const event_category = typeof job.ec === 'string' ? job.ec : '';
        const event_action = typeof job.ea === 'string' ? job.ea : '';
        const event_label = typeof job.el === 'string' ? job.el : '';
        const event_value: number | null =
            typeof job.ev === 'number'
                ? (Number.isFinite(job.ev) ? job.ev : null)
                : typeof job.ev === 'string'
                    ? (() => {
                        const n = Number(job.ev);
                        return Number.isFinite(n) ? n : null;
                    })()
                    : null;
        const meta: IngestMeta = (job.meta ?? {}) as IngestMeta;
        const referrer = typeof job.r === 'string' ? job.r : null;
        // parser guarantees ip/ua are present + sanitized (fallbacks applied)
        const userAgent = job.ua as string;
        const ip = job.ip as string;
        const ingest_id = typeof job.ingest_id === 'string' ? job.ingest_id : undefined;
        const url = getFinalUrl(job);

        Sentry.setTag('ingest_id', ingest_id || 'none');
        Sentry.setTag('qstash_message_id', qstashMessageId || 'none');
        Sentry.setContext('sync_worker', {
            ingest_id: ingest_id || null,
            qstash_message_id: qstashMessageId || null,
            site_public_id: site_id,
            event_action: event_action || null,
            event_category: event_category || null,
        });

        // --- 1. Site Logic ---
        const { valid: siteValid, site } = await SiteService.validateSite(site_id);
        if (!siteValid || !site) return NextResponse.json({ ok: true });
        siteDbId = site.id;

        // --- 1.5 Idempotency (QStash retries safe) ---
        const dedupInput = qstashMessageId
            ? `qstash:${qstashMessageId}`
            : `fallback:${site_id}:${client_sid || ''}:${event_action || ''}:${url}`;
        dedupEventId = await deterministicUuidFromString(dedupInput);

        Sentry.setTag('ingest_dedup_event_id', dedupEventId);
        Sentry.setTag('site_id', site.id);

        debugLog('[SYNC_WORKER] start', {
            ingest_id,
            qstash_message_id: qstashMessageId,
            dedup_event_id: dedupEventId,
            site_id: site.id,
            action: event_action,
            category: event_category,
        });

        const { error: dedupError } = await adminClient
            .from('processed_signals')
            .insert({ event_id: dedupEventId, site_id: site.id, status: 'processing' });

        if (dedupError) {
            if (isUniqueViolation(dedupError)) {
                // Already processed — return 200 so QStash will stop retrying.
                debugLog('[SYNC_WORKER] dedup hit', {
                    ingest_id,
                    qstash_message_id: qstashMessageId,
                    dedup_event_id: dedupEventId,
                    site_id: site.id,
                });
                return NextResponse.json({ ok: true, dedup: true });
            }
            throw dedupError;
        }

        // --- 2. Real-time Aggr (only after dedup). Best-effort: Redis failure must not fail the job. ---
        if (event_action !== 'heartbeat') {
            const hasGclid = !!(new URL(url).searchParams.get('gclid') || meta?.gclid);
            await incrementCapturedSafe(site_id, hasGclid);
        }

        // --- 2. Context Layer ---
        const geoResult = extractGeoInfo(null, userAgent, meta);
        const { geoInfo, deviceInfo } = geoResult;
        // Producer sends geo data from Vercel/Cloudflare headers; worker has no client req
        // Override geoInfo with producer-extracted values (these come from edge headers)
        if (typeof job.geo_city === 'string' && job.geo_city) geoInfo.city = job.geo_city;
        if (typeof job.geo_district === 'string' && job.geo_district) geoInfo.district = job.geo_district;
        if (typeof job.geo_country === 'string' && job.geo_country) geoInfo.country = job.geo_country;
        if (typeof job.geo_timezone === 'string' && job.geo_timezone) geoInfo.timezone = job.geo_timezone;
        if (typeof job.geo_telco_carrier === 'string' && job.geo_telco_carrier) geoInfo.telco_carrier = job.geo_telco_carrier;
        if (job.isp_asn != null) {
            geoInfo.isp_asn =
                typeof job.isp_asn === 'string'
                    ? job.isp_asn
                    : typeof job.isp_asn === 'number'
                        ? String(job.isp_asn)
                        : geoInfo.isp_asn;
        }
        if (job.is_proxy_detected != null) geoInfo.is_proxy_detected = Boolean(job.is_proxy_detected);

        const urlObj = new URL(url);
        const params = urlObj.searchParams;
        const currentGclid = params.get('gclid') || meta?.gclid || null;
        const fingerprint = meta?.fp || null;

        // CRITICAL: dbMonth must match trigger logic (TRT timezone, month from created_at UTC)
        // Trigger: date_trunc('month', (created_at AT TIME ZONE 'utc'))::date
        // Since created_at will be NOW() in UTC, we compute month from UTC now, matching trigger
        const dbMonth = session_month || (() => {
            const nowUtc = new Date();
            const year = nowUtc.getUTCFullYear();
            const month = String(nowUtc.getUTCMonth() + 1).padStart(2, '0');
            return `${year}-${month}-01`;
        })();

        // --- 3. Attribution & Session ---
        const { attribution, utm } = await AttributionService.resolveAttribution(site.id, currentGclid, fingerprint, url, referrer);

        const attributionSource = attribution.source;
        const deviceType = (utm?.device && /^(mobile|desktop|tablet)$/i.test(utm.device))
            ? utm.device.toLowerCase()
            : deviceInfo.device_type;

        const session = await SessionService.handleSession(
            site.id,
            dbMonth,
            {
                client_sid, url, currentGclid, meta, params,
                attributionSource, deviceType, fingerprint, utm,
                referrer
            },
            { ip, userAgent, geoInfo, deviceInfo }
        );

        // --- 4. Event & Score ---
        let summary = 'Standard Traffic';
        if (attributionSource.includes('Ads')) summary = 'Ads Origin';

        const { leadScore } = await EventService.createEvent({
            session: { id: session.id, created_month: session.created_month },
            siteId: site.id,
            url, event_category, event_action, event_label, event_value,
            meta, referrer, currentGclid, attributionSource, summary,
            fingerprint, ip, userAgent, geoInfo, deviceInfo, client_sid,
            ingestDedupId: dedupEventId
        });

        // --- 5. Intent ---
        if (event_action !== 'heartbeat') {
            await IntentService.handleIntent(
                site.id,
                { id: session.id },
                { fingerprint, event_action, event_label, meta, url, currentGclid, params },
                leadScore
            );
        }

        // Mark ledger as processed
        await adminClient
            .from('processed_signals')
            .update({ status: 'processed' })
            .eq('event_id', dedupEventId);

        debugLog('[SYNC_WORKER] success', {
            ingest_id,
            qstash_message_id: qstashMessageId,
            dedup_event_id: dedupEventId,
            site_id: site.id,
            session_id: session.id,
            score: leadScore,
        });

        return NextResponse.json({ success: true, score: leadScore });

    } catch (error) {
        // Best-effort: mark ledger as failed
        if (dedupEventId) {
            try {
                await adminClient
                    .from('processed_signals')
                    .update({ status: 'failed' })
                    .eq('event_id', dedupEventId);
            } catch { /* ignore */ }
        }

        // DLQ for non-retryable errors; retry for transient ones
        const ingestIdFromPayload =
            isRecord(rawBody) && typeof rawBody.ingest_id === 'string'
                ? rawBody.ingest_id
                : null;
        const retryable = isRetryableError(error);
        Sentry.setTag('ingest_id', ingestIdFromPayload || 'none');
        Sentry.setContext('sync_worker_error', {
            ingest_id: ingestIdFromPayload,
            qstash_message_id: qstashMessageId,
            site_id: siteDbId,
            dedup_event_id: dedupEventId,
            retryable,
        });
        if (!retryable) {
            try {
                await adminClient
                    .from('sync_dlq')
                    .insert({
                        site_id: siteDbId,
                        qstash_message_id: qstashMessageId,
                        dedup_event_id: dedupEventId,
                        stage: 'sync_worker',
                        error: getErrorMessage(error),
                        payload: isRecord(rawBody) ? rawBody : { note: 'rawBody_unavailable_or_non_object' }
                    });
            } catch { /* ignore */ }

            logError('QSTASH_WORKER_DLQ', {
                route: 'sync_worker',
                ingest_id: ingestIdFromPayload ?? undefined,
                qstash_message_id: qstashMessageId ?? undefined,
                site_id: siteDbId ?? undefined,
                dedup_event_id: dedupEventId ?? undefined,
                error: getErrorMessage(error),
            });
            Sentry.captureException(error);
            // Return 200 so QStash won't retry a poison message.
            return NextResponse.json({ ok: true, dlq: true });
        }

        logError('QSTASH_WORKER_ERROR', {
            route: 'sync_worker',
            ingest_id: ingestIdFromPayload ?? undefined,
            qstash_message_id: qstashMessageId ?? undefined,
            site_id: siteDbId ?? undefined,
            error: getErrorMessage(error),
        });
        Sentry.captureException(error);
        return NextResponse.json({ error: 'Worker failed' }, { status: 500 });
    }
}

// In prod: always verify QStash signature; no bypass. Missing keys -> 503. Dev bypass only with ALLOW_INSECURE_DEV_WORKER=true.
export const POST = requireQstashSignature(handler);
