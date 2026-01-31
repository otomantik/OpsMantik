import { adminClient } from '@/lib/supabase/admin';
import { debugLog, debugWarn } from '@/lib/utils';

export class IntentService {
    static async handleIntent(
        siteId: string,
        session: { id: string },
        data: {
            fingerprint: string | null,
            event_action: string,
            event_label: string,
            meta: any,
            url: string,
            currentGclid: string | null,
            params: URLSearchParams,
        },
        leadScore: number
    ) {
        const { fingerprint, event_action, event_label, meta, url, currentGclid, params } = data;

        // Goal: tel/wa clicks MUST create call intents regardless of acquisition/conversion rewrites.
        const PHONE_ACTIONS = new Set(['phone_call', 'phone_click', 'call_click', 'tel_click']);
        const WHATSAPP_ACTIONS = new Set(['whatsapp', 'whatsapp_click', 'wa_click']);

        const rawAction = (meta?.intent_action || event_action || '').toString().trim().toLowerCase();
        const action = rawAction;
        const isPhone = PHONE_ACTIONS.has(action);
        const isWa = WHATSAPP_ACTIONS.has(action);

        // Back-compat: treat legacy actions/labels as phone/wa signals
        const labelLc = (event_label || '').toString().toLowerCase();
        const legacyPhoneSignal =
            ['phone_call', 'phone_click', 'call_click'].includes((event_action || '').toString().toLowerCase()) ||
            labelLc.startsWith('tel:');
        const legacyWaSignal =
            ((event_action || '').toString().toLowerCase() === 'whatsapp') ||
            labelLc.includes('wa.me') ||
            labelLc.includes('whatsapp.com');

        const shouldCreateIntent = !!session && (!!fingerprint || !!session.id) && (isPhone || isWa || legacyPhoneSignal || legacyWaSignal);

        if (!shouldCreateIntent) return;

        // 1. Normalize Action & Target
        const canonicalAction: 'phone' | 'whatsapp' = (isPhone || legacyPhoneSignal) ? 'phone' : 'whatsapp';
        const canonicalTarget = canonicalAction === 'phone'
            ? this.normalizeTelTarget(event_label || meta?.phone_number || '')
            : this.normalizeWaTarget(event_label || '');

        // 2. Prepare Intent Data
        const intentPageUrl = (typeof url === 'string' && url.length > 0) ? url.slice(0, 2048) : null;
        const clickId = currentGclid
            || params.get('wbraid') || meta?.wbraid
            || params.get('gbraid') || meta?.gbraid
            || null;

        // Server fallback stamp
        const intentStamp = this.generateIntentStamp(meta?.intent_stamp, canonicalAction, canonicalTarget);

        // 3. Upsert / Dedupe
        let stampEnsured = false;
        if (intentStamp) {
            const { error: upsertErr } = await adminClient
                .from('calls')
                .upsert({
                    site_id: siteId,
                    phone_number: canonicalTarget || 'Unknown',
                    matched_session_id: session.id,
                    matched_fingerprint: fingerprint,
                    lead_score: leadScore,
                    lead_score_at_match: leadScore,
                    status: 'intent',
                    source: 'click',
                    intent_stamp: intentStamp,
                    intent_action: canonicalAction,
                    intent_target: canonicalTarget,
                    intent_page_url: intentPageUrl,
                    click_id: clickId,
                }, { onConflict: 'site_id,intent_stamp', ignoreDuplicates: true });

            if (upsertErr) {
                debugWarn('[SYNC_API] intent_stamp upsert failed (falling back to 10s dedupe):', {
                    code: upsertErr.code,
                });
            } else {
                stampEnsured = true;
                debugLog('[SYNC_API] ✅ Call intent ensured (stamp):', { intent_stamp: intentStamp });
            }
        }

        if (!stampEnsured) {
            await this.fallbackDedupe(
                siteId, session.id, fingerprint, leadScore, canonicalAction, canonicalTarget,
                intentPageUrl, clickId, intentStamp
            );
        }
    }

    private static async fallbackDedupe(
        siteId: string, sessionId: string, fingerprint: string | null, leadScore: number,
        action: 'phone' | 'whatsapp', target: string, pageUrl: string | null, clickId: string | null,
        intentStamp: string
    ) {
        // Fallback dedupe (10s): site_id + matched_session_id + action + target
        const tenSecondsAgo = new Date(Date.now() - 10 * 1000).toISOString();
        const { data: existingIntent } = await adminClient
            .from('calls')
            .select('id')
            .eq('site_id', siteId)
            .eq('matched_session_id', sessionId)
            .eq('source', 'click')
            .or('status.eq.intent,status.is.null')
            .eq('intent_action', action)
            .eq('intent_target', target)
            .gte('created_at', tenSecondsAgo)
            .maybeSingle();

        if (!existingIntent) {
            const { error: callError } = await adminClient
                .from('calls')
                .insert({
                    site_id: siteId,
                    phone_number: target || 'Unknown',
                    matched_session_id: sessionId,
                    matched_fingerprint: fingerprint,
                    lead_score: leadScore,
                    lead_score_at_match: leadScore,
                    status: 'intent',
                    source: 'click',
                    intent_stamp: intentStamp,
                    intent_action: action,
                    intent_target: target,
                    intent_page_url: pageUrl,
                    click_id: clickId,
                });

            if (callError) {
                if (callError.code !== '23505') { // Ignore unique violation
                    debugWarn('[SYNC_API] Failed to create call intent (fallback):', callError.message);
                }
            } else {
                debugLog('[SYNC_API] ✅ Call intent created (fallback):', { action });
            }
        }
    }

    // --- Helpers ---

    private static generateIntentStamp(raw: string | undefined, action: string, target: string): string {
        const rand4 = (): string => Math.random().toString(36).slice(2, 6).padEnd(4, '0');
        const hash6 = (v: string): string => {
            const s = (v || '').toString();
            let h = 0;
            for (let i = 0; i < s.length; i++) {
                h = ((h << 5) - h) + s.charCodeAt(i);
                h |= 0;
            }
            const out = Math.abs(h).toString(36);
            return out.slice(0, 6).padEnd(6, '0');
        };

        let stamp = (typeof raw === 'string' && raw.trim().length > 0) ? raw.trim() : '';
        if (!stamp) {
            stamp = `${Date.now()}-${rand4()}-${action}-${hash6(target)}`;
        }
        return stamp.slice(0, 128);
    }

    private static normalizeTelTarget(v: string): string {
        const s = (v || '').toString().trim();
        const noScheme = s.toLowerCase().startsWith('tel:') ? s.slice(4) : s;
        const phone = this.canonicalizePhoneDigits(noScheme);
        return phone ? `tel:${phone}` : 'tel:unknown';
    }

    private static normalizeWaTarget(v: string): string {
        const raw = (v || '').toString().trim();
        if (!raw) return 'wa:unknown';
        const candidate = raw.replace(/^https?:\/\//i, '');

        let url: URL | null = null;
        try {
            url = new URL(raw.match(/^https?:\/\//i) ? raw : `https://${candidate}`);
        } catch {
            url = null;
        }

        const phoneParam = url?.searchParams?.get('phone') || url?.searchParams?.get('p');
        if (phoneParam) {
            const phone = this.canonicalizePhoneDigits(phoneParam);
            if (phone) return `wa:${phone}`;
        }

        if (url?.hostname?.toLowerCase() === 'wa.me') {
            const seg = (url.pathname || '').split('/').filter(Boolean)[0] || '';
            const phone = this.canonicalizePhoneDigits(seg);
            if (phone) return `wa:${phone}`;
        }

        const pathDigits = (url?.pathname || '').replace(/[^\d]/g, '');
        if (pathDigits && pathDigits.length >= 10) {
            const phone = this.canonicalizePhoneDigits(pathDigits);
            if (phone) return `wa:${phone}`;
        }

        const host = url?.hostname ? url.hostname.toLowerCase() : candidate.split('/')[0].toLowerCase();
        const path = url?.pathname ? url.pathname : ('/' + candidate.split('/').slice(1).join('/'));
        const safe = `${host}${path}`.replace(/\/+$/, '');
        return `wa:${safe || 'unknown'}`;
    }

    private static canonicalizePhoneDigits(raw: string): string | null {
        const s = (raw || '').toString().trim();
        if (!s) return null;
        let cleaned = s.replace(/[^\d+]/g, '');
        if (!cleaned) return null;
        if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);

        const digits = cleaned.replace(/[^\d]/g, '');
        const hasPlus = cleaned.startsWith('+');

        if (!hasPlus) {
            if (digits.length === 10) return `+90${digits}`;
            if (digits.length === 11 && digits.startsWith('0')) return `+90${digits.slice(1)}`;
            if (digits.length >= 11 && digits.startsWith('90')) return `+${digits}`;
            return `+${digits}`;
        }

        if (digits.length >= 11 && digits.startsWith('90')) return `+${digits}`;
        return `+${digits}`;
    }
}
