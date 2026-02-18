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
            meta: Record<string, unknown>,
            url: string,
            currentGclid: string | null,
            params: URLSearchParams,
        },
        leadScore: number
    ) {
        const { fingerprint, event_action, event_label, meta, url, currentGclid, params } = data;

        // Goal: tel/wa clicks MUST create call intents regardless of acquisition/conversion rewrites.
        const PHONE_ACTIONS = new Set(['phone_call', 'phone_click', 'call_click', 'tel_click']);
        const WHATSAPP_ACTIONS = new Set(['whatsapp', 'whatsapp_click', 'wa_click', 'joinchat']);

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
            labelLc.includes('whatsapp.com') ||
            labelLc.includes('chat.whatsapp.com') ||
            labelLc.includes('joinchat');

        const shouldCreateIntent = !!session && (!!fingerprint || !!session.id) && (isPhone || isWa || legacyPhoneSignal || legacyWaSignal);

        if (!shouldCreateIntent) return;

        // 1. Normalize Action & Target
        const canonicalAction: 'phone' | 'whatsapp' = (isPhone || legacyPhoneSignal) ? 'phone' : 'whatsapp';
        const phoneFromMeta = typeof meta?.phone_number === 'string' ? meta.phone_number : '';
        const canonicalTarget = canonicalAction === 'phone'
            ? this.normalizeTelTarget(event_label || phoneFromMeta || '')
            : this.normalizeWaTarget(event_label || '');

        // 2. Prepare Intent Data
        const intentPageUrl = (typeof url === 'string' && url.length > 0) ? url.slice(0, 2048) : null;
        const wbraid = typeof meta?.wbraid === 'string' ? meta.wbraid : null;
        const gbraid = typeof meta?.gbraid === 'string' ? meta.gbraid : null;
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
        });

        if (ensureErr) {
            debugWarn('[SYNC_API] ensure_session_intent_v1 failed:', { code: ensureErr.code, message: ensureErr.message });
            return;
        }

        debugLog('[SYNC_API] ✅ Session intent ensured:', {
            session_id: session.id,
            call_id: ensuredId ?? null,
            action: canonicalAction,
        });
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
