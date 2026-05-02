import { adminClient } from '@/lib/supabase/admin';
import { createHash } from 'node:crypto';
import { debugLog, debugWarn } from '@/lib/utils';
import { logWarn, logError } from '@/lib/logging/logger';
import type { GeoInfo, DeviceInfo } from '@/lib/geo';
import { determineTrafficSource } from '@/lib/analytics/source-classifier';
import { sanitizeClickId, computeUtmUpdates } from '@/lib/attribution';
import type { IngestMeta } from '@/lib/types/ingest';
import { hasValidClickId } from '@/lib/ingest/bot-referrer-gates';
import { decideGeo } from '@/lib/geo/decision-engine';
import { upsertSessionGeo } from '@/lib/geo/upsert-session-geo';
import { inferIntentAction, normalizePhoneTarget } from '@/lib/api/call-event/shared';
import {
    burstRpcSessionReuseAllowed,
    normalizeSessionReuseLifecycleStatus,
    type SessionReuseDecision,
    shouldReuseSessionV1,
} from '@/lib/intents/session-reuse-v1';
import { intentSessionReuseHardeningEnabled } from '@/lib/config/intent-session-reuse-hardening';

/** PR-OCI-7.3.1: Evidence-based weights for monotonic attribution (never downgrade Paid → Organic) */
const ATTRIBUTION_WEIGHTS: Record<string, number> = {
    'First Click (Paid)': 100,
    'Paid (UTM)': 80,
    'Ads Assisted': 60,
    'Paid Social': 40,
    Organic: 20,
    Direct: 10,
    Unknown: 0,
};

interface SessionContext {
    ip: string;
    userAgent: string;
    geoInfo: GeoInfo;
    deviceInfo: DeviceInfo;
}

interface IncomingData {
    client_sid: string;
    url: string;
    currentGclid?: string | null;
    meta?: IngestMeta;
    params: URLSearchParams;
    attributionSource: string;
    deviceType: string;
    fingerprint?: string | null;
    /** KVKK/GDPR consent scopes (analytics, marketing). Set when sync passed consent check. */
    consent_scopes?: string[];
    event_action?: string | null;
    event_label?: string | null;
    utm?: {
        source?: string; medium?: string; campaign?: string; term?: string; content?: string;
        adgroup?: string; matchtype?: string; device?: string; device_model?: string;
        network?: string; placement?: string; adposition?: string;
        target_id?: string; feed_item_id?: string; loc_interest_ms?: string; loc_physical_ms?: string;
    } | null;
    referrer?: string | null;
}

function hashTarget(value: string | null): string | null {
    if (!value) return null;
    return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
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
                .select('id, site_id, created_month, attribution_source, gclid, wbraid, gbraid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, utm_adgroup, ads_network, ads_placement, ads_adposition, matchtype, device_model, ads_target_id, ads_feed_item_id, loc_interest_ms, loc_physical_ms')
                .eq('id', client_sid)
                .eq('site_id', siteId)
                .eq('created_month', dbMonth)
                .maybeSingle();

            if (lookupError) {
                console.error('[SYNC_API] Session lookup error:', lookupError.message);
                throw new Error('Session lookup failed: ' + lookupError.message);
            } else if (existingSession) {
                debugLog('[SYNC_API] Found existing session:', client_sid, 'in partition:', dbMonth);
                session = existingSession;
                await this.updateSessionIfNecesary(session, siteId, data, context, dbMonth);
            } else {
                debugLog('[SYNC_API] No existing session found for UUID:', client_sid, 'in partition:', dbMonth);
            }
        } else {
            debugWarn('[SYNC_API] Invalid UUID format for session_id:', client_sid, '- will create new session');
        }

        // Step B: Create session if not found
        if (!session) {
            const finalSessionId = isUuid ? client_sid : this.generateUUID();
            if (intentSessionReuseHardeningEnabled()) {
                const rawTarget = typeof data.event_label === 'string' ? data.event_label : null;
                const normalizedTarget = rawTarget && rawTarget.trim() ? normalizePhoneTarget(rawTarget) : null;
                const intentAction =
                    normalizedTarget && normalizedTarget.toLowerCase().startsWith('whatsapp:')
                        ? 'whatsapp'
                        : inferIntentAction(rawTarget || '');
                const primaryClickId =
                    sanitizeClickId(data.currentGclid ?? null) ??
                    sanitizeClickId(data.params.get('wbraid') || data.meta?.wbraid || null) ??
                    sanitizeClickId(data.params.get('gbraid') || data.meta?.gbraid || null) ??
                    null;
                const primaryClickIdValid = hasValidClickId({
                    gclid: sanitizeClickId(data.currentGclid ?? null) ?? null,
                    wbraid: sanitizeClickId(data.params.get('wbraid') || data.meta?.wbraid || null) ?? null,
                    gbraid: sanitizeClickId(data.params.get('gbraid') || data.meta?.gbraid || null) ?? null,
                });
                const rpcClickId =
                    primaryClickId && primaryClickIdValid ? primaryClickId : null;

                const canAttemptRpcBurst =
                    Boolean(normalizedTarget) && ['phone', 'whatsapp', 'form'].includes(intentAction);

                if (canAttemptRpcBurst) {
                    const { data: reuseRows, error: reuseErr } = await adminClient.rpc('find_or_reuse_session_v1', {
                        p_site_id: siteId,
                        p_primary_click_id: rpcClickId,
                        p_intent_action: intentAction,
                        p_normalized_intent_target: normalizedTarget,
                        p_occurred_at: new Date().toISOString(),
                        p_candidate_session_id: isUuid ? client_sid : null,
                        p_proposed_session_id: finalSessionId,
                        p_fingerprint: data.fingerprint ?? null,
                        p_entry_page: data.url ?? null,
                        p_ip_address: context.ip ?? null,
                        p_user_agent: context.userAgent ?? null,
                        p_gclid: sanitizeClickId(data.currentGclid ?? null) ?? null,
                        p_wbraid: sanitizeClickId(data.params.get('wbraid') || data.meta?.wbraid || null) ?? null,
                        p_gbraid: sanitizeClickId(data.params.get('gbraid') || data.meta?.gbraid || null) ?? null,
                        p_attribution_source: data.attributionSource ?? null,
                        p_traffic_source: null,
                        p_traffic_medium: null,
                        p_device_type: data.deviceType ?? null,
                        p_device_os: context.deviceInfo.os ?? null,
                    });
                    const firstReuseRow = Array.isArray(reuseRows) && reuseRows.length > 0 ? reuseRows[0] as {
                        matched_session_id?: string | null;
                        matched_session_month?: string | null;
                        reused?: boolean | null;
                        reason?: string | null;
                        candidate_session_id?: string | null;
                        time_delta_ms?: number | null;
                        lifecycle_status?: string | null;
                    } : null;

                    if (!reuseErr && firstReuseRow?.matched_session_id) {
                        const reuseReasonRpc = firstReuseRow.reason ?? '';
                        const trivialRpcSession =
                            reuseReasonRpc === 'fallback_candidate_session' ||
                            reuseReasonRpc === 'created_new_session';
                        const burstOk = burstRpcSessionReuseAllowed(reuseReasonRpc, firstReuseRow);

                        const reuseDecision: SessionReuseDecision =
                            trivialRpcSession ?
                                {
                                    reuse: true,
                                    reason: reuseReasonRpc,
                                    telemetry: {
                                        primary_click_id_present: Boolean(primaryClickId),
                                        intent_action: intentAction || 'unknown',
                                        normalized_target_present: Boolean(normalizedTarget?.trim()),
                                        time_delta_ms:
                                            typeof firstReuseRow.time_delta_ms === 'number' &&
                                            Number.isFinite(firstReuseRow.time_delta_ms)
                                                ? Math.max(0, Math.round(firstReuseRow.time_delta_ms))
                                                : null,
                                        lifecycle_status: normalizeSessionReuseLifecycleStatus(
                                            firstReuseRow.lifecycle_status ?? null
                                        ),
                                        candidate_session_id:
                                            firstReuseRow.candidate_session_id ??
                                            firstReuseRow.matched_session_id ??
                                            null,
                                    },
                                }
                            : burstOk ?
                                {
                                    reuse: true,
                                    reason: reuseReasonRpc || 'burst_rpc',
                                    telemetry: {
                                        primary_click_id_present: Boolean(primaryClickId),
                                        intent_action: intentAction || 'unknown',
                                        normalized_target_present: Boolean(normalizedTarget?.trim()),
                                        time_delta_ms:
                                            typeof firstReuseRow.time_delta_ms === 'number' &&
                                            Number.isFinite(firstReuseRow.time_delta_ms)
                                                ? Math.max(0, Math.round(firstReuseRow.time_delta_ms))
                                                : null,
                                        lifecycle_status: null,
                                        candidate_session_id:
                                            firstReuseRow.candidate_session_id ??
                                            firstReuseRow.matched_session_id ??
                                            null,
                                    },
                                }
                            :   shouldReuseSessionV1({
                                    siteMatches: true,
                                    primaryClickId: rpcClickId,
                                    primaryClickIdValid: Boolean(rpcClickId && primaryClickIdValid),
                                    intentAction,
                                    candidateIntentAction: intentAction,
                                    normalizedIntentTarget: normalizedTarget,
                                    candidateIntentTarget: normalizedTarget,
                                    timeDeltaMs: firstReuseRow.time_delta_ms ?? null,
                                    lifecycleStatus: firstReuseRow.lifecycle_status ?? null,
                                    candidateSessionId:
                                        firstReuseRow.candidate_session_id ??
                                        firstReuseRow.matched_session_id ??
                                        null,
                                });

                        debugLog('session_reuse_decision', {
                            reuse_hit: reuseDecision.reuse,
                            reuse_miss_reason: reuseDecision.reason,
                            site_id: siteId,
                            primary_click_id_present: rpcClickId !== null,
                            trivial_rpc_session: trivialRpcSession,
                            secondary_burst_ok: burstOk,
                            intent_action: intentAction,
                            normalized_intent_target_hash: hashTarget(normalizedTarget),
                            candidate_session_id: reuseDecision.telemetry.candidate_session_id,
                            matched_session_id: firstReuseRow.matched_session_id,
                            time_delta_ms: firstReuseRow.time_delta_ms ?? null,
                            lifecycle_status:
                                burstOk ? null : (firstReuseRow.lifecycle_status ?? null),
                            source_path: 'sync',
                        });

                        if (reuseDecision.reuse) {
                            return {
                                id: firstReuseRow.matched_session_id,
                                created_month: firstReuseRow.matched_session_month || dbMonth,
                            };
                        }
                    }

                    if (reuseErr) {
                        logWarn('SESSION_REUSE_RPC_FAILED', {
                            site_id: siteId,
                            error: reuseErr.message,
                            reason: 'fallback_to_create_session',
                            source_path: 'sync',
                        });
                    }
                }
            }
            session = await this.createSession(finalSessionId, siteId, dbMonth, data, context);
        }

        return session;
    }

    private static async updateSessionIfNecesary(
        session: {
            id: string; site_id?: string; created_month: string; attribution_source?: string | null; gclid?: string | null; wbraid?: string | null; gbraid?: string | null;
            utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null; utm_term?: string | null; utm_content?: string | null;
            utm_adgroup?: string | null; ads_network?: string | null; ads_placement?: string | null; ads_adposition?: string | null; matchtype?: string | null;
            device_model?: string | null; ads_target_id?: string | null; ads_feed_item_id?: string | null; loc_interest_ms?: string | null; loc_physical_ms?: string | null;
        },
        siteId: string,
        data: IncomingData,
        context: SessionContext,
        dbMonth: string
    ) {
        const { utm, currentGclid, params, meta, attributionSource, deviceType, fingerprint } = data;
        const { geoInfo, deviceInfo } = context;

        const hasNewUTM = Boolean(
            utm?.source || utm?.medium || utm?.campaign || utm?.term || utm?.content || utm?.adgroup
            || utm?.matchtype || utm?.device || utm?.device_model || utm?.network || utm?.placement || utm?.adposition
            || utm?.target_id || utm?.feed_item_id || utm?.loc_interest_ms || utm?.loc_physical_ms
        );
        const hasNewClickId = Boolean(currentGclid || params.get('wbraid') || params.get('gbraid') || meta?.wbraid || meta?.gbraid);
        const shouldUpdate = hasNewUTM || hasNewClickId || !session.attribution_source;

        if (shouldUpdate) {
            const traffic = determineTrafficSource(data.url, data.referrer || '', {
                utm_source: utm?.source ?? null,
                utm_medium: utm?.medium ?? null,
                utm_campaign: utm?.campaign ?? null,
                utm_term: utm?.term ?? null,
                utm_content: utm?.content ?? null,
                gclid: currentGclid ?? null,
                wbraid: params.get('wbraid') || meta?.wbraid || null,
                gbraid: params.get('gbraid') || meta?.gbraid || null,
                fbclid: params.get('fbclid') || meta?.fbclid || null,
                ttclid: params.get('ttclid') || meta?.ttclid || null,
                msclkid: params.get('msclkid') || meta?.msclkid || null,
            });

            const rawGclid = currentGclid ?? null;
            const rawWbraid = params.get('wbraid') || meta?.wbraid || null;
            const rawGbraid = params.get('gbraid') || meta?.gbraid || null;
            const sanitizedGclid = sanitizeClickId(rawGclid) ?? null;
            const sanitizedWbraid = sanitizeClickId(rawWbraid) ?? null;
            const sanitizedGbraid = sanitizeClickId(rawGbraid) ?? null;

            const hasExistingGclid = session.gclid != null && String(session.gclid).trim() !== '';
            const hasExistingWbraid = session.wbraid != null && String(session.wbraid).trim() !== '';
            const hasExistingGbraid = session.gbraid != null && String(session.gbraid).trim() !== '';

            // PR-OCI-7.3.2: Click-ID immutability - do not overwrite when session already has valid click ID
            const sessionIsOrganic = session.attribution_source === 'Organic';
            const safeGclidUpdate = sessionIsOrganic
                ? (session.gclid ?? null)
                : (hasExistingGclid ? session.gclid ?? null : (sanitizedGclid || session.gclid || null));
            const safeWbraidUpdate = sessionIsOrganic
                ? null
                : (hasExistingWbraid ? session.wbraid ?? null : (sanitizedWbraid || session.wbraid || null));
            const safeGbraidUpdate = sessionIsOrganic
                ? null
                : (hasExistingGbraid ? session.gbraid ?? null : (sanitizedGbraid || session.gbraid || null));
            const geoDecision = decideGeo({
                hasValidClickId: hasValidClickId({
                    gclid: safeGclidUpdate,
                    wbraid: safeWbraidUpdate,
                    gbraid: safeGbraidUpdate,
                }),
                ipGeo: {
                    city: geoInfo.city,
                    district: geoInfo.district,
                },
            });

            const updates: Record<string, unknown> = {
                device_type: deviceType,
                device_os: deviceInfo.os || null,
                fingerprint: fingerprint,
                gclid: safeGclidUpdate,
                traffic_source: traffic.traffic_source,
                traffic_medium: traffic.traffic_medium,
            };
            if (!sessionIsOrganic) {
                if (safeWbraidUpdate != null) updates.wbraid = safeWbraidUpdate;
                if (safeGbraidUpdate != null) updates.gbraid = safeGbraidUpdate;
            } else {
                updates.wbraid = null;
                updates.gbraid = null;
            }

            // PR-OCI-7.3.2: Monotonic attribution - only upgrade, never downgrade
            const currentWeight = ATTRIBUTION_WEIGHTS[session.attribution_source ?? 'Unknown'] ?? 0;
            const newWeight = ATTRIBUTION_WEIGHTS[attributionSource] ?? 0;
            if (newWeight >= currentWeight) {
                updates.attribution_source = attributionSource;
            }

            // PR-OCI-7.1: UTM overwrite rule - overwrite only on strict upgrade; enrichment (NULL→value) always allowed
            const isUpgrade = newWeight > currentWeight;
            const utmUpdates = computeUtmUpdates(session, utm ?? undefined, isUpgrade);
            for (const [k, v] of Object.entries(utmUpdates)) {
                (updates as Record<string, unknown>)[k] = v;
            }
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

            const { error: updateErr } = await adminClient
                .from('sessions')
                .update(updates)
                .eq('id', session.id)
                .eq('site_id', siteId)
                .eq('created_month', dbMonth);

            if (updateErr) {
                // Log but do not throw — session enrichment failure must not abort event processing.
                // The core session record already exists; the update failure only loses enrichment
                // fields (geo, UTM, device) for this request. The next event for this session will retry.
                logWarn('SESSION_UPDATE_FAILED', {
                    session_id: session.id,
                    site_id: siteId,
                    error: updateErr.message,
                    code: updateErr.code,
                });
            } else {
                try {
                    await upsertSessionGeo({
                        siteId,
                        sessionId: session.id,
                        sessionMonth: dbMonth,
                        source: geoDecision.source,
                        city: geoDecision.city,
                        district: geoDecision.district,
                        reasonCode: geoDecision.reasonCode,
                        confidence: geoDecision.confidence,
                    });
                } catch (geoUpdateErr) {
                    logWarn('SESSION_GEO_UPSERT_FAILED', {
                        session_id: session.id,
                        site_id: siteId,
                        error: geoUpdateErr instanceof Error ? geoUpdateErr.message : String(geoUpdateErr),
                    });
                }
            }
        }
    }

    /** New session = clean slate for attribution. Only current request's click IDs (currentGclid, params, meta) are used; client must not send stale GCLID for new sessions (Sprint 1 GCLID re-entry fix). */
    private static async createSession(
        sessionId: string,
        siteId: string,
        dbMonth: string,
        data: IncomingData,
        context: SessionContext,
        _retryDepth = 0
    ): Promise<{ id: string; created_month: string }> {
        const { utm, currentGclid, params, meta, attributionSource, deviceType, fingerprint, url } = data;
        const { geoInfo, deviceInfo, ip } = context;

        debugLog('[SYNC_API] Creating NEW session:', { final_id: sessionId, partition: dbMonth });

        const traffic = determineTrafficSource(url, data.referrer || '', {
            utm_source: utm?.source ?? null,
            utm_medium: utm?.medium ?? null,
            utm_campaign: utm?.campaign ?? null,
            utm_term: utm?.term ?? null,
            utm_content: utm?.content ?? null,
            gclid: currentGclid ?? null,
            wbraid: params.get('wbraid') || meta?.wbraid || null,
            gbraid: params.get('gbraid') || meta?.gbraid || null,
            fbclid: params.get('fbclid') || meta?.fbclid || null,
            ttclid: params.get('ttclid') || meta?.ttclid || null,
            msclkid: params.get('msclkid') || meta?.msclkid || null,
        });

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

        // Sprint 3 GCLID Phase 2: If session is Organic, do not persist click IDs from payload (ghost attribution safety).
        // PR-OCI-7.1.3: sanitizeClickId for values from URL/meta before persisting
        const isOrganic = attributionSource === 'Organic' || ['Direct', 'SEO', 'Referral'].includes(traffic.traffic_source || '');
        const rawGclid = currentGclid ?? null;
        const rawWbraid = params.get('wbraid') || meta?.wbraid || null;
        const rawGbraid = params.get('gbraid') || meta?.gbraid || null;
        const safeGclid = isOrganic ? null : (sanitizeClickId(rawGclid) ?? null);
        const safeWbraid = isOrganic ? null : (sanitizeClickId(rawWbraid) ?? null);
        const safeGbraid = isOrganic ? null : (sanitizeClickId(rawGbraid) ?? null);
        const geoDecision = decideGeo({
            hasValidClickId: hasValidClickId({
                gclid: safeGclid,
                wbraid: safeWbraid,
                gbraid: safeGbraid,
            }),
            ipGeo: {
                city: geoInfo.city,
                district: geoInfo.district,
            },
        });
        if (isOrganic && (rawGclid || rawWbraid || rawGbraid)) {
            logWarn('CLICK_ID_DROPPED_ORGANIC_NULLING', {
                site_id: siteId,
                session_id: sessionId,
            });
        }

        // Always use the current server-side UTC month for partition routing.
        // The browser's sm/dbMonth can be stale (e.g. QStash replays across month boundaries,
        // long-lived browser sessions). The BEFORE trigger trg_sessions_set_created_month will
        // compute created_month from NOW() and would conflict with a stale past-month value.
        const insertNow = new Date();
        const insertMonth = `${insertNow.getUTCFullYear()}-${String(insertNow.getUTCMonth() + 1).padStart(2, '0')}-01`;

        const sessionPayload: Record<string, unknown> = {
            id: sessionId,
            site_id: siteId,
            ip_address: ip,
            entry_page: url, // Full landing URL
            gclid: safeGclid,
            wbraid: safeWbraid,
            gbraid: safeGbraid,
            // insertMonth matches what trg_sessions_set_created_month will compute from now().
            // dbMonth (browser's sm) is ONLY used for lookups, never for INSERT routing.
            created_month: insertMonth,
            attribution_source: attributionSource,
            traffic_source: traffic.traffic_source,
            traffic_medium: traffic.traffic_medium,
            device_type: deviceType,
            device_os: deviceInfo.os || null,
            city: geoDecision.city,
            district: geoDecision.district,
            fingerprint: fingerprint,
            utm_term: utm?.term || null,
            matchtype: utm?.matchtype || null,
            utm_source: utm?.source || null,
            utm_medium: utm?.medium || null,
            utm_campaign: utm?.campaign || null,
            utm_content: utm?.content || null,
            utm_adgroup: utm?.adgroup || null,
            ads_network: utm?.network || null,
            ads_placement: utm?.placement || null,
            ads_adposition: utm?.adposition || null,
            device_model: utm?.device_model || null,
            ads_target_id: utm?.target_id || null,
            ads_feed_item_id: utm?.feed_item_id || null,
            loc_interest_ms: utm?.loc_interest_ms || null,
            loc_physical_ms: utm?.loc_physical_ms || null,
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
        if (data.consent_scopes && data.consent_scopes.length > 0) {
            sessionPayload.consent_at = new Date().toISOString();
            sessionPayload.consent_scopes = data.consent_scopes;
        }

        const { data: newSession, error: sError } = await adminClient
            .from('sessions')
            .insert(sessionPayload)
            .select('id, created_month')
            .single();

        if (sError) {
            if (sError.code === '23505') {
                debugLog('[SYNC_API] Session insert duplicate (id, created_month) — scoped idempotent re-select');
                const { data: existing } = await adminClient
                    .from('sessions')
                    .select('id, created_month')
                    .eq('id', sessionId)
                    .eq('site_id', siteId)
                    .eq('created_month', insertMonth)
                    .single();
                if (existing) return existing;

                // Cross-tenant UUID collision: another site already owns this UUID.
                // Retry with a fresh UUID, but cap retries to avoid infinite recursion.
                // In practice crypto.randomUUID() collisions are astronomically rare (one per ~10^18 UUIDs),
                // so hitting the cap means something is structurally broken (e.g. non-random UUIDs).
                const MAX_RETRY_DEPTH = 3;
                if (_retryDepth >= MAX_RETRY_DEPTH) {
                    logError('SESSION_CREATE_UUID_COLLISION_EXHAUSTED', {
                        session_id: sessionId,
                        site_id: siteId,
                        partition: dbMonth,
                        retry_depth: _retryDepth,
                    });
                    throw new Error(`Session UUID collision retry limit (${MAX_RETRY_DEPTH}) exceeded — non-random UUIDs suspected`);
                }
                logWarn('SESSION_UUID_CROSS_TENANT_COLLISION', {
                    requested_session_id: sessionId,
                    site_id: siteId,
                    partition: dbMonth,
                    retry_depth: _retryDepth,
                });
                return this.createSession(this.generateUUID(), siteId, dbMonth, data, context, _retryDepth + 1);
            }
            logError('SESSION_INSERT_FAILED', {
                message: sError.message,
                session_id: sessionId,
                partition: dbMonth,
                code: sError.code,
            });
            throw sError;
        }
        try {
            await upsertSessionGeo({
                siteId,
                sessionId,
                sessionMonth: insertMonth,
                source: geoDecision.source,
                city: geoDecision.city,
                district: geoDecision.district,
                reasonCode: geoDecision.reasonCode,
                confidence: geoDecision.confidence,
            });
        } catch (geoUpdateErr) {
            logWarn('SESSION_GEO_UPSERT_AFTER_CREATE_FAILED', {
                site_id: siteId,
                session_id: sessionId,
                error: geoUpdateErr instanceof Error ? geoUpdateErr.message : String(geoUpdateErr),
            });
        }
        return newSession;
    }
}
