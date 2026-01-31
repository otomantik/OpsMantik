import { NextRequest, NextResponse } from 'next/server';
import { extractGeoInfo } from '@/lib/geo';
import * as Sentry from '@sentry/nextjs';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { createHash } from 'crypto';
import { adminClient } from '@/lib/supabase/admin';
import { debugLog } from '@/lib/utils';

// Services
import { SiteService } from '@/lib/services/site-service';
import { AttributionService } from '@/lib/services/attribution-service';
import { SessionService } from '@/lib/services/session-service';
import { EventService } from '@/lib/services/event-service';
import { IntentService } from '@/lib/services/intent-service';
import { StatsService } from '@/lib/services/stats-service';

function getQstashMessageId(req: NextRequest): string | null {
    return (
        req.headers.get('Upstash-Message-Id') ||
        req.headers.get('upstash-message-id') ||
        null
    );
}

function deterministicUuidFromString(input: string): string {
    // We need a UUID to reuse the existing `public.processed_signals` ledger (UUID PK).
    // Use a stable SHA-256 hash and force UUIDv5-like version/variant bits.
    const hex = createHash('sha256').update(input).digest('hex'); // 64 hex chars
    let raw = hex.slice(0, 32); // 128-bit

    // Set version nibble (index 12) to '5'
    raw = raw.slice(0, 12) + '5' + raw.slice(13);
    // Set variant nibble (index 16) to 'a' (10xx)
    raw = raw.slice(0, 16) + 'a' + raw.slice(17);

    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

function isUniqueViolation(err: unknown): boolean {
    const anyErr = err as any;
    return anyErr?.code === '23505' || /duplicate key value/i.test(anyErr?.message || '');
}

function isRetryableError(err: unknown): boolean {
    const anyErr = err as any;
    const message = String(anyErr?.message || '');
    const code = String(anyErr?.code || '');
    const status = typeof anyErr?.status === 'number' ? anyErr.status : undefined;

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
    let rawBody: any = null;

    try {
        qstashMessageId = getQstashMessageId(req);
        rawBody = await req.json();
        const {
            s: site_id, url, sid: client_sid, sm: session_month,
            ec: event_category, ea: event_action, el: event_label, ev: event_value,
            meta, r: referrer, ip, ua: userAgent,
            ingest_id
        } = rawBody;

        if (!site_id || !url) return NextResponse.json({ ok: true });

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
        dedupEventId = deterministicUuidFromString(dedupInput);

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

        // --- 2. Real-time Aggr (only after dedup) ---
        if (event_action !== 'heartbeat') {
            const hasGclid = !!(new URL(url).searchParams.get('gclid') || meta?.gclid);
            await StatsService.incrementCaptured(site_id, hasGclid);
        }

        // --- 2. Context Layer ---
        const geoResult = extractGeoInfo(null, userAgent, meta);
        const { geoInfo, deviceInfo } = geoResult;

        const urlObj = new URL(url);
        const params = urlObj.searchParams;
        const currentGclid = params.get('gclid') || meta?.gclid;
        const fingerprint = meta?.fp || null;
        const dbMonth = session_month || new Date().toISOString().slice(0, 7) + '-01';

        // --- 3. Attribution & Session ---
        const { attribution, utm } = await AttributionService.resolveAttribution(currentGclid, fingerprint, url, referrer);

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
            fingerprint, ip, userAgent, geoInfo, deviceInfo, client_sid
        });

        // --- 5. Intent ---
        await IntentService.handleIntent(
            site.id,
            { id: session.id },
            { fingerprint, event_action, event_label, meta, url, currentGclid, params },
            leadScore
        );

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
        const retryable = isRetryableError(error);
        if (!retryable) {
            try {
                await adminClient
                    .from('sync_dlq')
                    .insert({
                        site_id: siteDbId,
                        qstash_message_id: qstashMessageId,
                        dedup_event_id: dedupEventId,
                        stage: 'sync_worker',
                        error: String((error as any)?.message || error),
                        payload: rawBody ?? { note: 'rawBody unavailable' }
                    });
            } catch { /* ignore */ }

            console.error('[QSTASH_WORKER_DLQ]', error);
            Sentry.captureException(error);
            // Return 200 so QStash won't retry a poison message.
            return NextResponse.json({ ok: true, dlq: true });
        }

        console.error('[QSTASH_WORKER_ERROR]', error);
        Sentry.captureException(error);
        return NextResponse.json({ error: 'Worker failed' }, { status: 500 });
    }
}

// Fixed for App Router verification
export const POST = verifySignatureAppRouter(handler);
