/**
 * Tracker Configuration
 * Config fallback: opsmantikConfig (correct) || opmantikConfig (legacy) for backward compatibility.
 */
// Determine API endpoint with priority:
// 1. data-api attribute on the script tag
// 2. Default fallback: window.location.origin + '/api/sync'
const scriptTag = typeof document !== 'undefined' ? (document.currentScript || document.querySelector('script[data-ops-site-id], script[data-site-id]')) : null;
const dataApi = scriptTag ? scriptTag.getAttribute('data-api') : null;

export const CONFIG = {
    apiUrl: dataApi || (typeof window !== 'undefined' ? window.location.origin + '/api/sync' : ''),
    sessionKey: 'opsmantik_session_sid',
    fingerprintKey: 'opsmantik_session_fp',
    contextKey: 'opsmantik_session_context',
    contextWbraidKey: 'opsmantik_session_wbraid',
    contextGbraidKey: 'opsmantik_session_gbraid',
    sessionStartKey: 'opsmantik_session_start',
    heartbeatInterval: 60000,
    sessionTimeout: 1800000,
};

export function getSiteId() {
    const scriptTag = document.currentScript || document.querySelector('script[data-ops-site-id], script[data-site-id]');
    let siteId = scriptTag ? (scriptTag.getAttribute('data-ops-site-id') || scriptTag.getAttribute('data-site-id') || '') : '';

    if (!siteId && typeof window !== 'undefined') {
        const cfg = window.opsmantikConfig || window.opmantikConfig;
        if (cfg && typeof cfg.siteId === 'string') siteId = String(cfg.siteId);
    }

    if (!siteId) {
        const allScripts = document.getElementsByTagName('script');
        for (let i = 0; i < allScripts.length; i++) {
            const s = allScripts[i];
            const src = (s.src || '').toLowerCase();
            if ((src.indexOf('core.js') !== -1 || src.indexOf('ux-core.js') !== -1) && (s.getAttribute('data-ops-site-id') || s.getAttribute('data-site-id'))) {
                siteId = s.getAttribute('data-ops-site-id') || s.getAttribute('data-site-id') || '';
                break;
            }
        }
    }

    return siteId;
}
