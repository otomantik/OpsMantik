import { adminClient } from '@/lib/supabase/admin';
import { debugLog } from '@/lib/utils';
import { computeLeadScore } from '@/lib/scoring';

interface EventData {
    session: { id: string, created_month: string };
    siteId: string;
    url: string;
    event_category: string;
    event_action: string;
    event_label: string;
    event_value: number | null;
    meta: any;
    referrer: string | null;
    currentGclid: string | null;
    attributionSource: string;
    summary: string;
    fingerprint: string | null;
    ip: string;
    userAgent: string;
    geoInfo: any;
    deviceInfo: any;
    client_sid: string;
}

export class EventService {
    static async createEvent(data: EventData) {
        const {
            session, siteId, url, event_category, event_action, event_label, event_value,
            meta, referrer, currentGclid, attributionSource, summary, fingerprint, ip,
            userAgent, geoInfo, deviceInfo, client_sid
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

        const { error: eError } = await adminClient
            .from('events')
            .insert({
                session_id: session.id,
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
            });

        if (eError) {
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

        // Update session stats if needed (heartbeat/end)
        if (event_action === 'heartbeat' || event_action === 'session_end') {
            await this.updateSessionStats(session.id, session.created_month, event_action, meta);
        }

        return { leadScore };
    }

    public static async updateSessionStats(sessionId: string, sessionMonth: string, action: string, meta: any) {
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
