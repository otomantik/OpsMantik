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
        };

        const { data: newSession, error: sError } = await adminClient
            .from('sessions')
            .insert(sessionPayload)
            .select('id, created_month')
            .single();

        if (sError) {
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
