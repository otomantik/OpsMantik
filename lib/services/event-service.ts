import { adminClient } from '@/lib/supabase/admin';
import { debugLog } from '@/lib/utils';
import { computeLeadScore } from '@/lib/scoring';
import type { GeoInfo, DeviceInfo } from '@/lib/geo';

interface EventData {
    session: { id: string, created_month: string };
    siteId: string;
    url: string;
    event_category: string;
    event_action: string;
    event_label: string;
    event_value: number | null;
    meta: Record<string, unknown>;
    referrer: string | null;
    currentGclid: string | null;
    attributionSource: string;
    summary: string;
    fingerprint: string | null;
    ip: string;
    userAgent: string;
    geoInfo: GeoInfo;
    deviceInfo: DeviceInfo;
    client_sid: string;
    /** Optional idempotency key (worker dedup_event_id); duplicate insert → no double count */
    ingestDedupId?: string | null;
}

export class EventService {
    static async createEvent(data: EventData) {
        const {
            session, siteId, url, event_category, event_action, event_label, event_value,
            meta, referrer, currentGclid, attributionSource, summary, fingerprint, ip,
            userAgent, geoInfo, deviceInfo, client_sid, ingestDedupId
        } = data;

        debugLog('[SYNC_API] Inserting event for session:', session.id);

        // Determine category: GCLID affects only user interactions, not system events
        let finalCategory = event_category || 'interaction';

        // Override to acquisition only for non-system, non-conversion events with GCLID
        // Ads phone/wa clicks are sent as conversion events; do NOT rewrite them.
        if (currentGclid && event_category !== 'system' && event_category !== 'conversion') {
            finalCategory = 'acquisition';
        }

        // Calculate Score
        const isReturningAdUser = attributionSource === 'Ads Assisted' || (attributionSource.includes('Ads') && !currentGclid);
        const leadScore = computeLeadScore(
            { event_category: finalCategory, event_action, event_value },
            referrer || null,
            isReturningAdUser
        );

        const insertPayload: Record<string, unknown> = {
                session_id: session.id,
                // NOTE: session_month will be set by trigger (trg_events_set_session_month_from_session)
                // Trigger ensures it matches session.created_month (which is also trigger-set)
                session_month: session.created_month,
                site_id: siteId,
                url: url,
                event_category: finalCategory,
                event_action: event_action || 'view',
                event_label: event_label,
                event_value: event_value ? Number(event_value) : null,
                metadata: {
                    referrer,
                    ...meta,
                    client_sid,
                    fingerprint: fingerprint,
                    user_agent: userAgent,
                    ...deviceInfo,
                    ...geoInfo,
                    lead_score: leadScore,
                    attribution_source: attributionSource,
                    intelligence_summary: summary,
                    is_attributed_to_ads: !!currentGclid,
                    gclid: currentGclid,
                    ip_anonymized: ip.replace(/\.\d+$/, '.0')
                }
            };
        if (ingestDedupId) insertPayload.ingest_dedup_id = ingestDedupId;

        const { error: eError } = await adminClient
            .from('events')
            .insert(insertPayload);

        if (eError) {
            if (eError.code === '23505' && ingestDedupId) {
                debugLog('[SYNC_API] Event insert duplicate (ingest_dedup_id) — idempotent skip');
                return { leadScore: 0 };
            }
            console.error('[SYNC_API] Event insert failed:', {
                message: eError.message,
                session_id: session.id
            });
            throw eError;
        }

        debugLog('[SYNC_API] ✅ SUCCESS: Event inserted to DB:', {
            action: event_action,
            category: finalCategory,
            session_id: session.id.slice(0, 8) + '...',
        });

        // Update session stats: heartbeat, session_end, or conversion (Intent Pulse batch)
        if (event_action === 'heartbeat' || event_action === 'session_end' || event_category === 'conversion') {
            await this.updateSessionStats(session.id, session.created_month, event_action, meta);
        }

        return { leadScore };
    }

    public static async updateSessionStats(sessionId: string, sessionMonth: string, action: string, meta: Record<string, unknown>) {
        const updates: Record<string, unknown> = {};

        if (meta?.duration_sec) {
            updates.total_duration_sec = meta.duration_sec;
        }

        // Behavioral Forensics
        if (meta?.scroll_pct) {
            updates.max_scroll_percentage = meta.scroll_pct;
        }
        if (meta?.cta_hovers) {
            updates.cta_hover_count = meta.cta_hovers;
        }
        if (meta?.focus_dur) {
            updates.form_focus_duration = meta.focus_dur;
        }
        if (meta?.active_sec) {
            updates.total_active_seconds = meta.active_sec;
        }

        if (action === 'session_end' && meta?.exit_page) {
            updates.exit_page = meta.exit_page;
        }

        if (Object.keys(updates).length > 0) {
            // We can also increment event count atomically in SQL if needed, roughly tracking here
            // Using rpc or simple update
            await adminClient
                .from('sessions')
                .update(updates)
                .eq('id', sessionId)
                .eq('created_month', sessionMonth);
        }
    }
}
