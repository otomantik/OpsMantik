import { adminClient } from '@/lib/supabase/admin';
import { debugLog, debugWarn } from '@/lib/utils';

interface SessionContext {
    ip: string;
    userAgent: string;
    geoInfo: any;
    deviceInfo: any;
}

interface IncomingData {
    client_sid: string;
    url: string;
    currentGclid?: string | null;
    meta?: any;
    params: URLSearchParams;
    attributionSource: string;
    deviceType: string;
    fingerprint?: string | null;
    utm?: any;
    referrer?: string | null;
}

export class SessionService {
    // UUID v4 generator (RFC 4122 compliant)
    private static generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    static async handleSession(
        siteId: string,
        dbMonth: string,
        data: IncomingData,
        context: SessionContext
    ) {
        let session;
        const { client_sid } = data;

        // Step A: Attempt to find existing session
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
                throw new Error('Session lookup failed: ' + lookupError.message);
            } else if (existingSession) {
                debugLog('[SYNC_API] Found existing session:', client_sid, 'in partition:', dbMonth);
                session = existingSession;
                await this.updateSessionIfNecesary(session, data, context, dbMonth);
            } else {
                debugLog('[SYNC_API] No existing session found for UUID:', client_sid, 'in partition:', dbMonth);
            }
        } else {
            debugWarn('[SYNC_API] Invalid UUID format for session_id:', client_sid, '- will create new session');
        }

        // Step B: Create session if not found
        if (!session) {
            const finalSessionId = isUuid ? client_sid : this.generateUUID();
            session = await this.createSession(finalSessionId, siteId, dbMonth, data, context);
        }

        return session;
    }

    private static async updateSessionIfNecesary(session: any, data: IncomingData, context: SessionContext, dbMonth: string) {
        const { utm, currentGclid, params, meta, attributionSource, deviceType, fingerprint } = data;
        const { geoInfo, deviceInfo } = context;

        const hasNewUTM = Boolean(
            utm?.source || utm?.medium || utm?.campaign || utm?.term || utm?.content
            || utm?.matchtype || utm?.device || utm?.network || utm?.placement
        );
        const hasNewClickId = Boolean(currentGclid || params.get('wbraid') || params.get('gbraid') || meta?.wbraid || meta?.gbraid);
        const shouldUpdate = hasNewUTM || hasNewClickId || !session.attribution_source;

        if (shouldUpdate) {
            const updates: Record<string, unknown> = {
                device_type: deviceType,
                device_os: deviceInfo.os || null,
                city: geoInfo.city !== 'Unknown' ? geoInfo.city : null,
                district: geoInfo.district,
                fingerprint: fingerprint,
                gclid: currentGclid || session.gclid || null,
            };
            const newWbraid = params.get('wbraid') || meta?.wbraid;
            const newGbraid = params.get('gbraid') || meta?.gbraid;
            if (newWbraid) updates.wbraid = newWbraid;
            if (newGbraid) updates.gbraid = newGbraid;

            // UTM merging logic
            updates.attribution_source = attributionSource;
            updates.utm_term = utm?.term ?? null;
            updates.matchtype = utm?.matchtype ?? null;
            updates.utm_source = utm?.source ?? null;
            updates.utm_medium = utm?.medium ?? null;
            updates.utm_campaign = utm?.campaign ?? null;
            updates.utm_content = utm?.content ?? null;
            updates.ads_network = utm?.network ?? null;
            updates.ads_placement = utm?.placement ?? null;
            updates.telco_carrier = geoInfo.telco_carrier ?? null;
            updates.browser = deviceInfo.browser || null;
            updates.isp_asn = geoInfo.isp_asn ?? null;
            updates.is_proxy_detected = geoInfo.is_proxy_detected ?? false;

            // Hardware DNA Updates
            updates.browser_language = deviceInfo.browser_language;
            updates.device_memory = deviceInfo.device_memory;
            updates.hardware_concurrency = deviceInfo.hardware_concurrency;
            updates.screen_width = deviceInfo.screen_width;
            updates.screen_height = deviceInfo.screen_height;
            updates.pixel_ratio = deviceInfo.pixel_ratio;
            updates.gpu_renderer = deviceInfo.gpu_renderer;

            // Extended Signals
            updates.connection_type = meta?.con_type || null;
            if (data.referrer) {
                try {
                    updates.referrer_host = new URL(data.referrer).hostname;
                } catch {
                    updates.referrer_host = data.referrer;
                }
            }

            if (utm?.device && /^(mobile|desktop|tablet)$/i.test(utm.device)) {
                updates.device_type = utm.device.toLowerCase();
            }

            await adminClient
                .from('sessions')
                .update(updates)
                .eq('id', session.id)
                .eq('created_month', dbMonth);
        }
    }

    private static async createSession(
        sessionId: string,
        siteId: string,
        dbMonth: string,
        data: IncomingData,
        context: SessionContext
    ) {
        const { utm, currentGclid, params, meta, attributionSource, deviceType, fingerprint, url } = data;
        const { geoInfo, deviceInfo, ip } = context;

        debugLog('[SYNC_API] Creating NEW session:', { final_id: sessionId, partition: dbMonth });

        // Prompt 2.2 Returning Giant: count previous sessions with same fingerprint in last 7 days
        let previousVisitCount = 0;
        if (fingerprint) {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const { count, error: countErr } = await adminClient
                .from('sessions')
                .select('id', { count: 'exact', head: true })
                .eq('site_id', siteId)
                .eq('fingerprint', fingerprint)
                .gte('created_at', sevenDaysAgo);
            if (!countErr && typeof count === 'number') {
                previousVisitCount = count;
            }
        }

        const sessionPayload: Record<string, unknown> = {
            id: sessionId,
            site_id: siteId,
            ip_address: ip,
            entry_page: url, // Full landing URL
            gclid: currentGclid,
            wbraid: params.get('wbraid') || meta?.wbraid,
            gbraid: params.get('gbraid') || meta?.gbraid,
            created_month: dbMonth,
            attribution_source: attributionSource,
            device_type: deviceType,
            device_os: deviceInfo.os || null,
            city: geoInfo.city !== 'Unknown' ? geoInfo.city : null,
            district: geoInfo.district,
            fingerprint: fingerprint,
            utm_term: utm?.term || null,
            matchtype: utm?.matchtype || null,
            utm_source: utm?.source || null,
            utm_medium: utm?.medium || null,
            utm_campaign: utm?.campaign || null,
            utm_content: utm?.content || null,
            ads_network: utm?.network || null,
            ads_placement: utm?.placement || null,
            telco_carrier: geoInfo.telco_carrier || null,
            browser: deviceInfo.browser || null,
            isp_asn: geoInfo.isp_asn ?? null,
            is_proxy_detected: geoInfo.is_proxy_detected ?? false,
            // Hardware DNA
            browser_language: deviceInfo.browser_language,
            device_memory: deviceInfo.device_memory,
            hardware_concurrency: deviceInfo.hardware_concurrency,
            screen_width: deviceInfo.screen_width,
            screen_height: deviceInfo.screen_height,
            pixel_ratio: deviceInfo.pixel_ratio,
            gpu_renderer: deviceInfo.gpu_renderer,
            // Extended Signals
            connection_type: meta?.con_type || null,
            referrer_host: (function () {
                if (!data.url && !data.referrer) return null;
                try {
                    return new URL(data.referrer || '').hostname || null;
                } catch {
                    return data.referrer || null;
                }
            })(),
            is_returning: previousVisitCount > 0,
            visitor_rank: previousVisitCount >= 1 ? 'VETERAN_HUNTER' : null,
            previous_visit_count: previousVisitCount,
        };

        const { data: newSession, error: sError } = await adminClient
            .from('sessions')
            .insert(sessionPayload)
            .select('id, created_month')
            .single();

        if (sError) {
            if (sError.code === '23505') {
                debugLog('[SYNC_API] Session insert duplicate (id, created_month) — idempotent re-select');
                const { data: existing } = await adminClient
                    .from('sessions')
                    .select('id, created_month')
                    .eq('id', sessionId)
                    .eq('created_month', dbMonth)
                    .single();
                if (existing) return existing;
            }
            console.error('[SYNC_API] Session insert failed:', {
                message: sError.message,
                session_id: sessionId,
                partition: dbMonth
            });
            throw sError;
        }
        return newSession;
    }
}
