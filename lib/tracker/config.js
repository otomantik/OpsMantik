/**
 * Tracker Configuration
 * Config fallback: opsmantikConfig (correct) || opmantikConfig (legacy) for backward compatibility.
 */
// Determine API endpoint with priority:
// 1. explicit data-sync-proxy / config sync proxy
// 2. data-api attribute on the script tag
// 3. derive a sibling /sync endpoint from the call-event proxy
// 4. Default fallback: window.location.origin + '/api/sync'
const scriptTag = typeof document !== 'undefined' ? (document.currentScript || document.querySelector('script[data-ops-site-id], script[data-site-id]')) : null;
const proxyUrl = scriptTag ? scriptTag.getAttribute('data-ops-proxy-url') : null;
const syncProxyUrl = scriptTag ? scriptTag.getAttribute('data-ops-sync-proxy-url') : null;
const dataApi = scriptTag ? scriptTag.getAttribute('data-api') : null;
const runtimeConfig = typeof window !== 'undefined' ? (window.opsmantikConfig || window.opmantikConfig || {}) : {};

function deriveSyncProxyUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.replace(/\/call-event\/?$/i, '/sync');
}

const resolvedApiUrl =
    syncProxyUrl ||
    runtimeConfig.opsSyncProxyUrl ||
    dataApi ||
    deriveSyncProxyUrl(proxyUrl || runtimeConfig.opsProxyUrl || '') ||
    (typeof window !== 'undefined' ? window.location.origin + '/api/sync' : '');

// Warn once when sync URL is same-origin: events would go to the current site (no /api/sync there).
if (typeof window !== 'undefined' && resolvedApiUrl) {
    try {
        const apiHost = new URL(resolvedApiUrl).hostname;
        const pageHost = window.location.hostname;
        if (apiHost === pageHost) {
            console.warn(
                '[OPSMANTIK] Sync URL is same-origin (' + resolvedApiUrl + '). Events will not reach OpsMantik. Set data-api (or data-ops-sync-proxy-url) on the script tag to your OpsMantik backend, e.g. data-api="https://YOUR_APP.vercel.app/api/sync"'
            );
        }
    } catch { /* ignore */ }
}

export const CONFIG = {
    apiUrl: resolvedApiUrl,
    trackerVersion: runtimeConfig.opsTrackerVersion || 'core-shadow-2026-11-05',
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
