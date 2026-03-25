import { adminClient } from '@/lib/supabase/admin';
import { debugLog } from '@/lib/utils';
import { logError } from '@/lib/logging/logger';
import { normalizePhoneTarget } from '@/lib/api/call-event/shared';

export type EnsuredIntentResult = {
    callId: string;
    canonicalAction: 'phone' | 'whatsapp' | 'form';
    canonicalTarget: string;
    clickId: string | null;
    intentPageUrl: string | null;
    formState: string | null;
};

export class IntentService {
    static async handleIntent(
        siteId: string,
        session: { id: string },
        data: {
            fingerprint: string | null,
            event_action: string,
            event_label: string,
            meta: Record<string, unknown>,
            url: string,
            currentGclid: string | null,
            params: URLSearchParams,
        },
        leadScore: number
    ): Promise<EnsuredIntentResult | null> {
        const { fingerprint, event_action, event_label, meta, url, currentGclid, params } = data;

        // Goal: tel/wa clicks MUST create call intents regardless of acquisition/conversion rewrites.
        const PHONE_ACTIONS = new Set(['phone_call', 'phone_click', 'call_click', 'tel_click']);
        const WHATSAPP_ACTIONS = new Set(['whatsapp', 'whatsapp_click', 'wa_click', 'joinchat']);
        const FORM_ACTIONS = new Set([
            'form',
            'form_submit',
            'form_start',
            'form_submit_attempt',
            'form_submit_success',
            'form_submit_validation_failed',
            'form_submit_network_failed'
        ]);

        const rawAction = (meta?.intent_action || event_action || '').toString().trim().toLowerCase();
        const action = rawAction;
        const isPhone = PHONE_ACTIONS.has(action);
        const isWa = WHATSAPP_ACTIONS.has(action);
        const isForm = FORM_ACTIONS.has(action);

        // Back-compat: treat legacy actions/labels as phone/wa signals
        const labelLc = (event_label || '').toString().toLowerCase();
        const legacyPhoneSignal =
            ['phone_call', 'phone_click', 'call_click'].includes((event_action || '').toString().toLowerCase()) ||
            labelLc.startsWith('tel:');
        const legacyWaSignal =
            ((event_action || '').toString().toLowerCase() === 'whatsapp') ||
            labelLc.includes('wa.me') ||
            labelLc.includes('whatsapp.com') ||
            labelLc.includes('chat.whatsapp.com') ||
            labelLc.includes('joinchat');
        const legacyFormSignal =
            ((event_action || '').toString().toLowerCase() === 'form_submit') ||
            action === 'form' ||
            labelLc.startsWith('form:');

        const shouldCreateIntent = !!session && (!!fingerprint || !!session.id) && (isPhone || isWa || isForm || legacyPhoneSignal || legacyWaSignal || legacyFormSignal);

        if (!shouldCreateIntent) return null;

        // 1. Normalize Action & Target
        const canonicalAction: 'phone' | 'whatsapp' | 'form' =
            (isPhone || legacyPhoneSignal) ? 'phone' :
                ((isWa || legacyWaSignal) ? 'whatsapp' : 'form');
        const explicitIntentTarget = typeof meta?.intent_target === 'string' ? meta.intent_target.trim() : '';
        const phoneFromMeta = typeof meta?.phone_number === 'string' ? meta.phone_number : '';
        const canonicalTarget = canonicalAction === 'phone'
            ? (explicitIntentTarget || this.normalizeTelTarget(event_label || phoneFromMeta || ''))
            : canonicalAction === 'whatsapp'
                ? (explicitIntentTarget || this.normalizeWaTarget(event_label || ''))
                : (explicitIntentTarget || this.normalizeFormTarget(event_label || '', url));

        // 2. Prepare Intent Data
        const intentPageUrl = (typeof url === 'string' && url.length > 0) ? url.slice(0, 2048) : null;
        const wbraid = typeof meta?.wbraid === 'string' ? meta.wbraid : null;
        const gbraid = typeof meta?.gbraid === 'string' ? meta.gbraid : null;
        const formState = canonicalAction === 'form'
            ? this.normalizeFormState(event_action, typeof meta?.form_stage === 'string' ? meta.form_stage : null)
            : null;
        const formSummary = canonicalAction === 'form'
            ? this.sanitizeFormSummary(meta)
            : null;
        const clickId = currentGclid
            || params.get('wbraid') || wbraid
            || params.get('gbraid') || gbraid
            || null;

        // Server fallback stamp
        // Session-based single-card:
        // Use an atomic RPC that ensures ONE click-intent row per session and increments counters.
        // This prevents "one person => multiple queue items" while preserving "2x phone, 1x WhatsApp" evidence.
        const { data: ensuredId, error: ensureErr } = await adminClient.rpc('ensure_session_intent_v1', {
            p_site_id: siteId,
            p_session_id: session.id,
            p_fingerprint: fingerprint,
            p_lead_score: leadScore,
            p_intent_action: canonicalAction,
            p_intent_target: canonicalTarget,
            p_intent_page_url: intentPageUrl,
            p_click_id: clickId,
            p_form_state: formState,
            p_form_summary: formSummary,
        });

        if (ensureErr) {
            logError('ensure_session_intent_v1 failed', {
                code: (ensureErr as { code?: string })?.code,
                message: (ensureErr as { message?: string })?.message,
                site_id: siteId,
                session_id: session.id,
            });
            return null;
        }

        debugLog('[SYNC_API] ✅ Session intent ensured:', {
            session_id: session.id,
            call_id: ensuredId ?? null,
            action: canonicalAction,
        });
        const callId = typeof ensuredId === 'string' ? ensuredId : Array.isArray(ensuredId) ? (ensuredId[0] as string) ?? null : null;
        if (!callId) return null;

        return {
            callId,
            canonicalAction,
            canonicalTarget,
            clickId,
            intentPageUrl,
            formState,
        };
    }

    private static normalizeTelTarget(v: string): string {
        const s = (v || '').toString().trim();
        const noScheme = s.toLowerCase().startsWith('tel:') ? s.slice(4) : s;
        const phone = this.canonicalizePhoneDigits(noScheme);
        return phone ? `tel:${phone}` : 'tel:unknown';
    }

    private static normalizeWaTarget(v: string): string {
        const normalized = normalizePhoneTarget(v);
        if (normalized.toLowerCase().startsWith('whatsapp:')) return normalized;
        const raw = (v || '').toString().trim();
        if (!raw) return 'wa:unknown';
        if (raw.toLowerCase().startsWith('whatsapp://')) {
            const rest = raw.slice(12).replace(/^\/+/, '') || 'unknown';
            return `wa:${rest}`;
        }
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

        const host = url?.hostname ? url.hostname.toLowerCase() : '';
        const path = (url?.pathname || '').replace(/^\/+/, '') || '';
        if (host === 'chat.whatsapp.com') {
            const inviteCode = path.split('/')[0] || path || 'unknown';
            return `wa:chat/${inviteCode}`;
        }
        if (host === 'api.whatsapp.com' && path.startsWith('joinchat/')) {
            const code = path.replace(/^joinchat\/?/, '') || 'unknown';
            return `wa:joinchat/${code}`;
        }

        const pathDigits = (url?.pathname || '').replace(/[^\d]/g, '');
        if (pathDigits && pathDigits.length >= 10) {
            const phone = this.canonicalizePhoneDigits(pathDigits);
            if (phone) return `wa:${phone}`;
        }

        const hostFinal = url?.hostname ? url.hostname.toLowerCase() : candidate.split('/')[0].toLowerCase();
        const pathFinal = url?.pathname ? url.pathname : ('/' + candidate.split('/').slice(1).join('/'));
        const safe = `${hostFinal}${pathFinal}`.replace(/\/+$/, '');
        return `wa:${safe || 'unknown'}`;
    }

    private static normalizeFormTarget(v: string, pageUrl?: string | null): string {
        const raw = (v || '').toString().trim();
        if (raw.toLowerCase().startsWith('form:')) return raw;
        const safeRaw = raw.replace(/\s+/g, '_').slice(0, 160);
        if (safeRaw) return `form:${safeRaw}`;
        if (pageUrl) {
            try {
                const pathname = new URL(pageUrl).pathname || '/';
                return `form:${pathname}`;
            } catch {
                // Fall through to unknown
            }
        }
        return 'form:unknown';
    }

    private static normalizeFormState(eventAction: string | null | undefined, metaStage: string | null | undefined):
        'started' | 'attempted' | 'validation_failed' | 'network_failed' | 'success' | null {
        const raw = (metaStage || eventAction || '').toString().trim().toLowerCase();
        if (!raw) return null;
        if (raw === 'start' || raw === 'form_start' || raw === 'started') return 'started';
        if (raw === 'submit_attempt' || raw === 'attempt' || raw === 'form_submit_attempt' || raw === 'submitted') return 'attempted';
        if (raw === 'submit_validation_failed' || raw === 'validation_failed' || raw === 'form_submit_validation_failed') return 'validation_failed';
        if (raw === 'submit_network_failed' || raw === 'network_failed' || raw === 'form_submit_network_failed') return 'network_failed';
        if (raw === 'submit_success' || raw === 'success' || raw === 'form_submit_success') return 'success';
        if (raw === 'form_submit') return 'attempted';
        return null;
    }

    private static sanitizeFormSummary(meta: unknown): Record<string, unknown> | null {
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
        const root = meta as Record<string, unknown>;
        const summary = root.form_summary;
        const validation = root.form_validation;
        const src = summary && typeof summary === 'object' && !Array.isArray(summary)
            ? { ...(summary as Record<string, unknown>) }
            : {};
        if (validation && typeof validation === 'object' && !Array.isArray(validation)) {
            Object.assign(src, validation as Record<string, unknown>);
        }
        if (typeof root.form_transport === 'string') src.form_transport = root.form_transport;
        if (typeof root.form_trigger === 'string') src.form_trigger = root.form_trigger;
        if (typeof root.form_error === 'string') src.form_error = root.form_error;
        if (typeof root.form_http_status === 'number') src.form_http_status = root.form_http_status;
        const out: Record<string, unknown> = {};
        const intKeys = [
            'field_count',
            'visible_field_count',
            'required_field_count',
            'file_input_count',
            'textarea_count',
            'select_count',
            'checkbox_count',
            'radio_count',
            'invalid_field_count',
            'required_invalid_count',
            'file_invalid_count',
            'form_http_status'
        ];
        for (const key of intKeys) {
            const value = src[key];
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
                out[key] = Math.trunc(value);
            }
        }
        const boolKeys = ['has_phone_field', 'has_email_field', 'has_name_field', 'has_message_field', 'has_file_field'];
        for (const key of boolKeys) {
            if (typeof src[key] === 'boolean') out[key] = src[key];
        }
        const stringKeys = ['method', 'action_path', 'form_transport', 'form_trigger', 'form_error'];
        for (const key of stringKeys) {
            const value = src[key];
            if (typeof value === 'string' && value.trim() !== '') {
                out[key] = value.trim().slice(0, 160);
            }
        }
        return Object.keys(out).length > 0 ? out : null;
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
