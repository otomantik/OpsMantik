/**
 * Tracker Session Management
 */
import { CONFIG } from './config';
import { generateFingerprint, generateUUID } from './utils';

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

    // Extract GCLID
    const urlParams = new URLSearchParams(window.location.search);
    const gclid = urlParams.get('gclid') || context;
    if (gclid) {
        sessionStorage.setItem(CONFIG.contextKey, gclid);
        context = gclid;
    }

    return { sessionId, fingerprint, context };
}
