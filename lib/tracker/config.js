/**
 * Tracker Configuration
 */
export const CONFIG = {
    apiUrl: typeof window !== 'undefined' ? window.location.origin + '/api/sync' : '',
    sessionKey: 'opmantik_session_sid',
    fingerprintKey: 'opmantik_session_fp',
    contextKey: 'opmantik_session_context',
    sessionStartKey: 'opmantik_session_start',
    heartbeatInterval: 60000,
    sessionTimeout: 1800000,
};

export function getSiteId() {
    const scriptTag = document.currentScript || document.querySelector('script[data-ops-site-id], script[data-site-id]');
    let siteId = scriptTag ? (scriptTag.getAttribute('data-ops-site-id') || scriptTag.getAttribute('data-site-id') || '') : '';

    if (!siteId && typeof window !== 'undefined' && window.opmantikConfig && window.opmantikConfig.siteId) {
        siteId = String(window.opmantikConfig.siteId);
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
