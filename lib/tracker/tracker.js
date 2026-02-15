/**
 * main tracker entry point
 * P0-2: __opsmantikTrackerInitialized guard; heartbeat only when document visible.
 */
import { CONFIG, getSiteId } from './config';
import { getOrCreateSession } from './session';
import { addToOutbox, processOutbox, lastGaspFlush } from './transport';
import { getHardwareMeta, makeIntentStamp, generateUUID } from './utils';
import { pulse, getPulseMeta } from './pulse';

const siteId = getSiteId();
if (!siteId) {
    console.warn('[OPSMANTIK] ❌ Site ID not found');
} else {
    console.log('[OPSMANTIK] ✅ Tracker initializing for site:', siteId);
}

export function sendEvent(category, action, label, value, metadata = {}) {
    if (!siteId) return;
    const session = getOrCreateSession();
    const url = window.location.href;
    const referrer = document.referrer || '';
    const sessionMonth = new Date().toISOString().slice(0, 7) + '-01';

    const meta = { fp: session.fingerprint, gclid: session.context };
    const hw = getHardwareMeta();
    Object.assign(meta, hw);

    // Script tag geo backfill
    const scriptTag = document.currentScript || document.querySelector('script[data-ops-site-id]');
    if (scriptTag) {
        const dc = scriptTag.getAttribute('data-geo-city');
        const dd = scriptTag.getAttribute('data-geo-district');
        if (dc) meta.city = dc;
        if (dd) meta.district = dd;
    }

    if (category === 'conversion' || action === 'heartbeat' || action === 'session_end') {
        if (action === 'heartbeat') {
            pulse.activeSec += Math.round((Date.now() - pulse.lastActiveAt) / 1000);
            pulse.lastActiveAt = Date.now();
        }
        Object.assign(meta, getPulseMeta());
    }

    Object.assign(meta, metadata);

    const payload = {
        s: siteId,
        u: url,
        sid: session.sessionId,
        sm: sessionMonth,
        ec: category,
        ea: action,
        el: label,
        ev: value,
        r: referrer,
        meta: meta
    };

    addToOutbox(payload);
}

export function sendCallEvent(phoneNumber) {
    if (!siteId) return;
    const session = getOrCreateSession();
    const callEventUrl = window.location.origin + '/api/call-event/v2';
    const scriptTag = document.currentScript || document.querySelector('script[data-ops-site-id]');

    const proxyUrl = scriptTag?.getAttribute('data-ops-proxy-url') || window.opmantikConfig?.opsProxyUrl || '';
    const eventId = generateUUID();

    const payload = JSON.stringify({
        event_id: eventId,
        site_id: siteId,
        phone_number: phoneNumber,
        fingerprint: session.fingerprint,
        action: (typeof phoneNumber === 'string' && (phoneNumber.indexOf('wa.me') !== -1 || phoneNumber.indexOf('whatsapp') !== -1)) ? 'whatsapp' : 'phone',
        url: window.location.href,
        ua: navigator.userAgent
    });

    if (proxyUrl) {
        fetch(proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => { });
        return;
    }

    // HMAC-SHA256 signed V1 flow
    const secret = scriptTag?.getAttribute('data-ops-secret') || window.opmantikConfig?.opsSecret || '';
    if (secret && window.crypto?.subtle) {
        const ts = Math.floor(Date.now() / 1000);
        const enc = new TextEncoder();
        const msg = ts + '.' + payload;

        window.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
            .then(key => window.crypto.subtle.sign('HMAC', key, enc.encode(msg)))
            .then(sigBuf => {
                const hex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
                return fetch(callEventUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Ops-Site-Id': siteId,
                        'X-Ops-Ts': String(ts),
                        'X-Ops-Signature': hex
                    },
                    body: payload,
                    keepalive: true
                });
            })
            .catch(() => { });
        return;
    }

    // Unsigned fallback
    fetch(callEventUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => { });
}

export function initAutoTracking() {
    console.log('[OPSMANTIK] Auto-tracking initialized');
    sendEvent('interaction', 'view', document.title);

    document.addEventListener('click', (e) => {
        const tel = e.target.closest('a[href^="tel:"]');
        if (tel) {
            const stamp = makeIntentStamp('tel', tel.href);
            sendEvent('conversion', 'phone_call', tel.href, null, { intent_stamp: stamp, intent_action: 'phone_call' });
            sendCallEvent(tel.href);
            return;
        }
        const wa = e.target.closest('a[href*="wa.me"], a[href*="whatsapp.com"]');
        if (wa) {
            const stamp = makeIntentStamp('wa', wa.href);
            sendEvent('conversion', 'whatsapp', wa.href, null, { intent_stamp: stamp, intent_action: 'whatsapp' });
            sendCallEvent(wa.href);
        }
    });

    document.addEventListener('submit', (e) => {
        if (e.target.tagName === 'FORM') {
            sendEvent('conversion', 'form_submit', e.target.id || e.target.name || 'form');
        }
    });

    window.addEventListener('scroll', () => {
        const doc = document.documentElement;
        const scrollPercent = Math.round(((window.scrollY + window.innerHeight) / doc.scrollHeight) * 100);
        if (scrollPercent > pulse.maxScroll) {
            pulse.maxScroll = scrollPercent;
            if (scrollPercent >= 50 && scrollPercent < 90) sendEvent('interaction', 'scroll_depth', '50%', scrollPercent);
            else if (scrollPercent >= 90) sendEvent('interaction', 'scroll_depth', '90%', scrollPercent);
        }
    });

    document.addEventListener('mouseenter', (e) => {
        const cta = e.target.closest && e.target.closest('a[href^="tel:"], a[href*="wa.me"], a[href*="whatsapp.com"], [data-om-cta="true"]');
        if (cta) pulse.ctaHovers++;
    }, true);

    let focusStart = 0;
    document.addEventListener('focusin', (e) => {
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) focusStart = Date.now();
    });
    document.addEventListener('focusout', (e) => {
        if (focusStart > 0 && e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
            pulse.focusDur += Math.round((Date.now() - focusStart) / 1000);
            focusStart = 0;
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            pulse.activeSec += Math.round((Date.now() - pulse.lastActiveAt) / 1000);
        } else {
            pulse.lastActiveAt = Date.now();
            if (typeof localStorage !== 'undefined' && localStorage.getItem('opsmantik_debug') === '1') {
                console.log('[OPSMANTIK_DEBUG] heartbeat resumed (one immediate)');
            }
            sendEvent('system', 'heartbeat', 'session_active');
        }
    });

    setInterval(() => {
        if (document.hidden) {
            if (typeof localStorage !== 'undefined' && localStorage.getItem('opsmantik_debug') === '1') {
                console.log('[OPSMANTIK_DEBUG] heartbeat skipped due to hidden');
            }
            return;
        }
        sendEvent('system', 'heartbeat', 'session_active');
    }, CONFIG.heartbeatInterval);

    window.addEventListener('beforeunload', () => {
        pulse.activeSec += Math.round((Date.now() - pulse.lastActiveAt) / 1000);
        sendEvent('system', 'session_end', 'page_unload', null, { exit_page: window.location.href });
        lastGaspFlush();
    });
}

// Global exposure and init (P0-2: single init guard)
if (typeof window !== 'undefined') {
    if (window.__opsmantikTrackerInitialized) {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('opsmantik_debug') === '1') {
            console.warn('[OPSMANTIK_DEBUG] tracker init skipped (duplicate)', { ts: Date.now() });
        }
        return;
    }
    window.__opsmantikTrackerInitialized = true;
    window.opmantik = {
            send: sendEvent,
            session: getOrCreateSession,
            _initialized: true,
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                processOutbox();
                initAutoTracking();
            });
        } else {
            processOutbox();
            initAutoTracking();
        }

        window.addEventListener('online', processOutbox);
}
