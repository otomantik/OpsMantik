/**
 * Tracker Utilities
 */

export function generateFingerprint() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Fingerprint', 2, 2);

    const fingerprint = [
        navigator.userAgent,
        navigator.language,
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset(),
        canvas.toDataURL(),
    ].join('|');

    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
        const char = fingerprint.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function normalizeDialTarget(raw) {
    const normalized = (raw || '').toString().replace(/[^\d+]/g, '');
    return normalized.length > 0 ? normalized : null;
}

function canonicalizeWhatsAppTarget(raw) {
    const t = (raw || '').toString().trim();
    const lower = t.toLowerCase();
    if (
        !lower.startsWith('whatsapp:') &&
        !lower.startsWith('whatsapp://') &&
        !lower.includes('wa.me') &&
        !lower.includes('whatsapp.com') &&
        !lower.includes('chat.whatsapp.com') &&
        !lower.includes('joinchat')
    ) {
        return null;
    }

    const phoneFromQuery = (t.match(/[?&]phone=([^&#]+)/i) || [])[1] || null;
    const phoneFromWaMe = (t.match(/wa\.me\/([^/?#]+)/i) || [])[1] || null;
    const phoneFromScheme = (t.match(/^whatsapp:\s*(.+)$/i) || [])[1] || null;
    const rawPhoneCandidate = phoneFromQuery || phoneFromWaMe || phoneFromScheme || '';
    let decodedPhoneCandidate = rawPhoneCandidate;
    try {
        decodedPhoneCandidate = decodeURIComponent(rawPhoneCandidate);
    } catch {
        decodedPhoneCandidate = rawPhoneCandidate;
    }
    const normalizedPhone = normalizeDialTarget(decodedPhoneCandidate);
    if (normalizedPhone) {
        return `whatsapp:${normalizedPhone}`;
    }

    const hostMatch = t.match(/^https?:\/\/([^/?#]+)/i);
    const host = ((hostMatch || [])[1] || '').toLowerCase();
    const pathMatch = t.match(/^https?:\/\/[^/?#]+\/([^?#]+)/i);
    const path = (((pathMatch || [])[1] || '')).replace(/^\/+/, '');
    if (host === 'chat.whatsapp.com') {
        const inviteCode = path.split('/')[0] || 'unknown';
        return `whatsapp:joinchat/${inviteCode}`;
    }
    if ((host === 'api.whatsapp.com' || host === 'web.whatsapp.com') && path.toLowerCase().startsWith('joinchat')) {
        const inviteCode = path.replace(/^joinchat\/?/i, '') || 'unknown';
        return `whatsapp:joinchat/${inviteCode}`;
    }

    const canonicalUrl = t
        .replace(/^https?:\/\//i, '')
        .replace(/\?.*$/, '')
        .replace(/#.*$/, '')
        .replace(/\/+$/, '')
        .toLowerCase();
    return canonicalUrl ? `whatsapp:${canonicalUrl}` : 'whatsapp:unknown';
}

export function normalizePhoneTarget(raw) {
    const t = (raw || '').toString().trim();
    const lower = t.toLowerCase();
    const whatsappTarget = canonicalizeWhatsAppTarget(t);
    if (whatsappTarget) return whatsappTarget;
    if (lower.startsWith('callto:')) {
        return normalizeDialTarget(t.slice(7)) || '';
    }
    if (lower.startsWith('sms:')) {
        const noQuery = t.split('?')[0] || t;
        const after = noQuery.slice(4);
        return normalizeDialTarget(after) || noQuery;
    }
    if (lower.startsWith('tel:')) {
        return normalizeDialTarget(t.slice(4)) || '';
    }
    if (/^\+?\d[\d\s().-]{6,}$/.test(t)) {
        return normalizeDialTarget(t) || '';
    }
    return t;
}

export function inferIntentAction(raw) {
    const normalizedTarget = normalizePhoneTarget(raw).toLowerCase();
    const t = (raw || '').toString().toLowerCase();
    if (normalizedTarget.startsWith('whatsapp:')) return 'whatsapp';
    if (t.includes('wa.me') || t.includes('whatsapp.com') || t.includes('chat.whatsapp.com') || t.includes('joinchat') || t.startsWith('whatsapp://')) return 'whatsapp';
    if (t.startsWith('tel:') || t.startsWith('callto:') || t.startsWith('sms:')) return 'phone';
    return 'phone';
}

export function rand4() {
    return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export function hash6(str) {
    const s = (str || '').toString();
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    const out = Math.abs(h).toString(36);
    return out.slice(0, 6).padEnd(6, '0');
}

export function makeIntentStamp(actionShort, target) {
    const ts = Date.now();
    const tHash = hash6((target || '').toString().toLowerCase());
    return `${ts}-${rand4()}-${actionShort}-${tHash}`;
}

export function getHardwareMeta() {
    const o = {};
    try { if (navigator.language) o.lan = navigator.language; } catch { }
    try { if (typeof navigator.deviceMemory === 'number') o.mem = navigator.deviceMemory; } catch { }
    try { if (typeof navigator.hardwareConcurrency === 'number') o.con = navigator.hardwareConcurrency; } catch { }
    try { if (typeof screen !== 'undefined') { o.sw = screen.width; o.sh = screen.height; } } catch { }
    try { if (typeof window.devicePixelRatio === 'number') o.dpr = window.devicePixelRatio; } catch { }
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (ext) { const r = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); if (r) o.gpu = r; }
        }
    } catch { }
    try {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn && conn.effectiveType) o.con_type = conn.effectiveType;
    } catch { }
    return o;
}

/**
 * Extract Google Ads ValueTrack parameters from the landing page URL.
 * Returns an ads_context object for the call-event payload, or null if no params found.
 * Persists to sessionStorage so subsequent page navigations retain the data.
 */
export function getAdsContext() {
    const STORAGE_KEY = 'opsmantik_ads_ctx';
    try {
        const p = new URLSearchParams(window.location.search);
        const keyword = p.get('ops_kw') || undefined;
        const match_type = p.get('ops_mt') || undefined;
        const network = p.get('ops_net') || undefined;
        const device = p.get('ops_dv') || undefined;
        const device_model = p.get('ops_mdl') || undefined;
        const geoRaw = p.get('ops_geo');
        const geo_target_id = geoRaw ? (parseInt(geoRaw, 10) || undefined) : undefined;
        const campaign_id = p.get('ops_cmp') ? (parseInt(p.get('ops_cmp'), 10) || undefined) : undefined;
        const adgroup_id = p.get('ops_adg') ? (parseInt(p.get('ops_adg'), 10) || undefined) : undefined;
        const creative_id = p.get('ops_crt') ? (parseInt(p.get('ops_crt'), 10) || undefined) : undefined;
        const placement = p.get('ops_plc') || undefined;
        const target_id = p.get('ops_tgt') ? (parseInt(p.get('ops_tgt'), 10) || undefined) : undefined;

        const fromUrl = {};
        if (keyword) fromUrl.keyword = keyword;
        if (match_type) fromUrl.match_type = match_type;
        if (network) fromUrl.network = network;
        if (device) fromUrl.device = device;
        if (device_model) fromUrl.device_model = device_model;
        if (geo_target_id) fromUrl.geo_target_id = geo_target_id;
        if (campaign_id) fromUrl.campaign_id = campaign_id;
        if (adgroup_id) fromUrl.adgroup_id = adgroup_id;
        if (creative_id) fromUrl.creative_id = creative_id;
        if (placement) fromUrl.placement = placement;
        if (target_id) fromUrl.target_id = target_id;

        // Persist to sessionStorage on first landing
        if (Object.keys(fromUrl).length > 0) {
            try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fromUrl)); } catch { }
            return fromUrl;
        }

        // Fallback: read from session storage (user navigated away from landing page)
        try {
            const stored = sessionStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed;
            }
        } catch { }
    } catch { }
    return null;
}
