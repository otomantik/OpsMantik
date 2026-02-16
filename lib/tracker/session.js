/**
 * Tracker Session Management
 * Reads Google Ads template params from URL (search + hash) for session and meta.
 */
import { CONFIG } from './config';
import { generateFingerprint, generateUUID } from './utils';

/** Build URLSearchParams from location.search and from location.hash when it contains key=value (e.g. #?utm_term=x) */
function getUrlParams() {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    if (typeof window !== 'undefined' && window.location.hash) {
        const raw = window.location.hash.replace(/^#\??/, '');
        const afterQ = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw;
        if (afterQ.includes('=')) {
            try {
                const hashParams = new URLSearchParams(afterQ);
                hashParams.forEach((value, key) => { params.set(key, value); });
            } catch (_) { /* ignore */ }
        }
    }
    return params;
}

/** Extract Google Ads template params for meta (server also parses from event URL) */
function getTemplateParams(params) {
    const p = (key) => params.get(key) || undefined;
    return {
        utm_source: p('utm_source'),
        utm_medium: p('utm_medium'),
        utm_campaign: p('utm_campaign'),
        utm_adgroup: p('utm_adgroup'),
        utm_content: p('utm_content'),
        utm_term: p('utm_term'),
        device: p('device'),
        devicemodel: p('devicemodel'),
        targetid: p('targetid'),
        network: p('network'),
        adposition: p('adposition'),
        feeditemid: p('feeditemid'),
        loc_interest_ms: p('loc_interest_ms'),
        loc_physical_ms: p('loc_physical_ms'),
        matchtype: p('matchtype'),
    };
}

export function getOrCreateSession() {
    let sessionId = sessionStorage.getItem(CONFIG.sessionKey);
    let fingerprint = localStorage.getItem(CONFIG.fingerprintKey);
    let context = sessionStorage.getItem(CONFIG.contextKey);

    if (!fingerprint) {
        fingerprint = generateFingerprint();
        localStorage.setItem(CONFIG.fingerprintKey, fingerprint);
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (sessionId && !uuidRegex.test(sessionId)) {
        sessionId = null;
        sessionStorage.removeItem(CONFIG.sessionKey);
    }

    if (!sessionId) {
        sessionId = generateUUID();
        sessionStorage.setItem(CONFIG.sessionKey, sessionId);
        sessionStorage.setItem(CONFIG.sessionStartKey, Date.now().toString());
    } else if (!sessionStorage.getItem(CONFIG.sessionStartKey)) {
        sessionStorage.setItem(CONFIG.sessionStartKey, Date.now().toString());
    }

    const urlParams = getUrlParams();
    const gclid = urlParams.get('gclid') || context;
    const wbraid = urlParams.get('wbraid') || sessionStorage.getItem(CONFIG.contextWbraidKey);
    const gbraid = urlParams.get('gbraid') || sessionStorage.getItem(CONFIG.contextGbraidKey);
    if (gclid) {
        sessionStorage.setItem(CONFIG.contextKey, gclid);
        context = gclid;
    }
    if (wbraid) sessionStorage.setItem(CONFIG.contextWbraidKey, wbraid);
    if (gbraid) sessionStorage.setItem(CONFIG.contextGbraidKey, gbraid);

    const urlParamsObj = getTemplateParams(urlParams);
    return {
        sessionId,
        fingerprint,
        context,
        wbraid: wbraid || null,
        gbraid: gbraid || null,
        urlParams: urlParamsObj,
    };
}
