/**
 * main tracker entry point
 * P0-2: __opsmantikTrackerInitialized guard; heartbeat only when document visible.
 *
 * SST / proxy: We do NOT send client IP in the payload. The server resolves IP from the
 * request and MUST trust X-Forwarded-For (first) and X-Real-IP so the real client location
 * (e.g. Istanbul) is used, not the proxy/edge (e.g. Rome/Amsterdam).
 */
import { CONFIG, getSiteId } from './config';
import { getOrCreateSession } from './session';
import { addToOutbox, processOutbox, lastGaspFlush } from './transport';
import { getHardwareMeta, makeIntentStamp, generateUUID, getAdsContext, normalizePhoneTarget, inferIntentAction } from './utils';
import { pulse, getPulseMeta } from './pulse';

function getTrackerScriptTag() {
    const scripts = Array.from(document.getElementsByTagName('script'));
    const candidates = scripts.filter((s) => {
        const hasSiteAttr = Boolean(s.getAttribute('data-ops-site-id') || s.getAttribute('data-site-id'));
        if (!hasSiteAttr) return false;
        const src = String(s.getAttribute('src') || s.src || '').toLowerCase();
        return src.includes('/assets/core.js') || src.includes('/ux-core.js') || src.includes('core.js');
    });
    if (candidates.length === 0) {
        return (
            document.currentScript ||
            document.querySelector('script[data-ops-site-id]') ||
            document.querySelector('script[data-site-id]')
        );
    }

    const expectedSiteId = typeof siteId === 'string' ? siteId : '';
    const matchingBySite = expectedSiteId
        ? candidates.filter((s) => (s.getAttribute('data-ops-site-id') || s.getAttribute('data-site-id') || '') === expectedSiteId)
        : [];
    const pool = matchingBySite.length > 0 ? matchingBySite : candidates;

    const withAuth = pool.find((s) => s.getAttribute('data-ops-proxy-url') || s.getAttribute('data-ops-secret'));
    if (withAuth) return withAuth;
    return pool[pool.length - 1] || pool[0];
}

const recentTrackedIntentAt = new Map();
let lastPointerContext = null;
const ENABLE_FORM_TRACKING = false;
const FORM_PENDING_STORAGE_KEY = 'opsmantik_form_pending_v1';
const formLifecycleState = new WeakMap();
const pendingFormAttempts = [];

function isTrackerDebugEnabled() {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('opsmantik_debug') === '1') return true;
    } catch { }
    try {
        const tag = getTrackerScriptTag();
        if (tag && tag.getAttribute('data-ops-debug') === '1') return true;
    } catch { }
    return false;
}

function cleanupRecentIntentWindow(now) {
    for (const [key, ts] of recentTrackedIntentAt.entries()) {
        if (now - ts > 2500) recentTrackedIntentAt.delete(key);
    }
}

function inferWidgetSource(target, element) {
    const raw = [
        target || '',
        element?.id || '',
        element?.className || '',
        element?.getAttribute?.('data-om-whatsapp') || '',
        element?.getAttribute?.('data-jivo') || '',
        element?.getAttribute?.('aria-label') || ''
    ].join(' ').toLowerCase();
    if (raw.includes('jivo') || raw.includes('jivosite')) return 'jivo';
    if (raw.includes('joinchat')) return 'joinchat';
    return 'whatsapp';
}

function shouldTrackWhatsAppTarget(target) {
    return inferIntentAction(target || '') === 'whatsapp';
}

// Global Site ID check and init log
const siteId = getSiteId();
if (!siteId) {
    console.warn('[OPSMANTIK] ❌ Site ID not found');
} else {
    console.log('[OPSMANTIK] ✅ Tracker initializing for site:', siteId);
}

// GDPR / Consent - Default to analytics & marketing if no CMP detected (ensures OCI ingest)
let trackerConsentScopes = ['analytics', 'marketing'];

export function sendEvent(category, action, label, value, metadata = {}) {
    if (!siteId) return;
    const session = getOrCreateSession();
    const url = window.location.href;
    const referrer = document.referrer || '';
    const sessionMonth = new Date().toISOString().slice(0, 7) + '-01';

    const meta = {
        fp: session.fingerprint,
        gclid: session.context,
        wbraid: session.wbraid || undefined,
        gbraid: session.gbraid || undefined,
        om_tracker_version: CONFIG.trackerVersion
    };
    if (session.urlParams && typeof session.urlParams === 'object') {
        Object.keys(session.urlParams).forEach((k) => {
            if (session.urlParams[k] != null) meta[k] = session.urlParams[k];
        });
    }
    const hw = getHardwareMeta();
    Object.assign(meta, hw);

    // Script tag geo backfill
    const scriptTag = getTrackerScriptTag();
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
        meta: meta,
        consent_scopes: trackerConsentScopes
    };

    if (typeof localStorage !== 'undefined' && localStorage.getItem('opsmantik_debug') === '1') {
        console.log('[OPSMANTIK] Outbox:', category + '/' + action, session.sessionId.slice(0, 8) + '...');
    }

    addToOutbox(payload);
}

function buildCallIntentMeta(target) {
    const intentAction = inferIntentAction(target || '');
    const intentTarget = normalizePhoneTarget(target || '');
    const intentStamp = makeIntentStamp(intentAction === 'whatsapp' ? 'wa' : 'tel', intentTarget);
    return {
        intentAction,
        intentTarget,
        intentStamp,
        intentPageUrl: window.location.href
    };
}

function buildFormIntentMeta(form) {
    const currentPath = (() => {
        try {
            return new URL(window.location.href).pathname || '/';
        } catch {
            return '/';
        }
    })();
    const rawAction = form?.getAttribute?.('action') || '';
    let actionPath = '';
    if (rawAction) {
        try {
            actionPath = new URL(rawAction, window.location.href).pathname || '';
        } catch {
            actionPath = rawAction;
        }
    }
    const formIdentity =
        form?.id ||
        form?.getAttribute?.('name') ||
        form?.getAttribute?.('data-form-name') ||
        actionPath ||
        currentPath ||
        'unknown';
    const controls = Array.from(form?.querySelectorAll?.('input, textarea, select') || []).filter((el) => el && !el.disabled);
    const visibleControls = controls.filter((el) => {
        const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { width: 0, height: 0 };
        return !el.hidden && style?.display !== 'none' && style?.visibility !== 'hidden' && (rect.width > 0 || rect.height > 0);
    });
    const inferFieldRole = (el) => {
        const raw = [
            el?.type || '',
            el?.name || '',
            el?.id || '',
            el?.autocomplete || '',
            el?.placeholder || '',
            el?.getAttribute?.('aria-label') || ''
        ].join(' ').toLowerCase();
        return {
            hasPhoneField: raw.includes('phone') || raw.includes('tel') || raw.includes('gsm') || raw.includes('mobile'),
            hasEmailField: raw.includes('email') || raw.includes('mail'),
            hasNameField: raw.includes('name') || raw.includes('ad') || raw.includes('soyad'),
            hasMessageField: raw.includes('message') || raw.includes('mesaj') || raw.includes('note') || raw.includes('comment'),
            hasFileField: (el?.type || '').toLowerCase() === 'file' || raw.includes('file') || raw.includes('upload')
        };
    };
    const fieldRoles = controls.reduce((acc, el) => {
        const next = inferFieldRole(el);
        acc.hasPhoneField = acc.hasPhoneField || next.hasPhoneField;
        acc.hasEmailField = acc.hasEmailField || next.hasEmailField;
        acc.hasNameField = acc.hasNameField || next.hasNameField;
        acc.hasMessageField = acc.hasMessageField || next.hasMessageField;
        acc.hasFileField = acc.hasFileField || next.hasFileField;
        return acc;
    }, {
        hasPhoneField: false,
        hasEmailField: false,
        hasNameField: false,
        hasMessageField: false,
        hasFileField: false
    });
    const summary = {
        method: String(form?.getAttribute?.('method') || 'get').trim().toLowerCase() || 'get',
        action_path: actionPath || currentPath,
        field_count: controls.length,
        visible_field_count: visibleControls.length,
        required_field_count: controls.filter((el) => !!el.required).length,
        file_input_count: controls.filter((el) => (el?.type || '').toLowerCase() === 'file').length,
        textarea_count: controls.filter((el) => el?.tagName === 'TEXTAREA').length,
        select_count: controls.filter((el) => el?.tagName === 'SELECT').length,
        checkbox_count: controls.filter((el) => (el?.type || '').toLowerCase() === 'checkbox').length,
        radio_count: controls.filter((el) => (el?.type || '').toLowerCase() === 'radio').length,
        has_phone_field: fieldRoles.hasPhoneField,
        has_email_field: fieldRoles.hasEmailField,
        has_name_field: fieldRoles.hasNameField,
        has_message_field: fieldRoles.hasMessageField,
        has_file_field: fieldRoles.hasFileField
    };
    return {
        intentAction: 'form',
        intentTarget: `form:${String(formIdentity).trim() || 'unknown'}`,
        intentStamp: makeIntentStamp('form', `${currentPath}|${formIdentity}`),
        intentPageUrl: window.location.href,
        formSummary: summary
    };
}

function getFormLifecycleState(form) {
    if (!form) return null;
    let current = formLifecycleState.get(form);
    if (!current) {
        current = {
            startSent: false,
            lastAttemptAt: 0,
            lastValidationAt: 0
        };
        formLifecycleState.set(form, current);
    }
    return current;
}

function buildValidationSummary(form) {
    const controls = Array.from(form?.querySelectorAll?.('input, textarea, select') || []).filter((el) => el && !el.disabled);
    const invalid = controls.filter((el) => {
        try {
            return typeof el.matches === 'function' ? el.matches(':invalid') : false;
        } catch {
            return false;
        }
    });
    return {
        invalid_field_count: invalid.length,
        required_invalid_count: invalid.filter((el) => !!el.required).length,
        file_invalid_count: invalid.filter((el) => (el?.type || '').toLowerCase() === 'file').length
    };
}

function cleanupPendingForms(now = Date.now()) {
    for (let i = pendingFormAttempts.length - 1; i >= 0; i -= 1) {
        const item = pendingFormAttempts[i];
        if (!item || item.resolved || now - item.createdAt > 45000) {
            pendingFormAttempts.splice(i, 1);
        }
    }
}

function emitFormLifecycle(form, eventAction, extraMeta = {}) {
    if (!form) return null;
    const intentMeta = buildFormIntentMeta(form);
    const stage = (eventAction || '').replace(/^form_/, '').replace(/^submit_/, '');
    sendEvent('conversion', eventAction, intentMeta.intentTarget, null, {
        intent_stamp: intentMeta.intentStamp,
        intent_action: intentMeta.intentAction,
        intent_target: intentMeta.intentTarget,
        intent_page_url: intentMeta.intentPageUrl,
        form_stage: stage,
        form_summary: intentMeta.formSummary,
        ...extraMeta
    });
    return intentMeta;
}

function registerPendingFormAttempt(form, intentMeta, extraMeta = {}) {
    const actionPath = intentMeta?.formSummary?.action_path || '';
    const item = {
        form,
        intentTarget: intentMeta.intentTarget,
        intentPageUrl: intentMeta.intentPageUrl,
        formSummary: intentMeta.formSummary,
        actionPath,
        createdAt: Date.now(),
        resolved: false,
        extraMeta
    };
    pendingFormAttempts.push(item);
    cleanupPendingForms(item.createdAt);
    return item;
}

function resolvePendingForm(item, eventAction, extraMeta = {}) {
    if (!item || item.resolved) return false;
    item.resolved = true;
    sendEvent('conversion', eventAction, item.intentTarget, null, {
        intent_action: 'form',
        intent_target: item.intentTarget,
        intent_page_url: item.intentPageUrl,
        form_stage: (eventAction || '').replace(/^form_/, '').replace(/^submit_/, ''),
        form_summary: item.formSummary,
        ...item.extraMeta,
        ...extraMeta
    });
    cleanupPendingForms();
    return true;
}

function trackFormStart(form, trigger = 'interaction') {
    const state = getFormLifecycleState(form);
    if (!state || state.startSent) return;
    state.startSent = true;
    emitFormLifecycle(form, 'form_start', {
        form_trigger: trigger
    });
}

function trackFormValidationFailure(form, trigger = 'invalid') {
    const state = getFormLifecycleState(form);
    if (!state) return;
    const now = Date.now();
    if (now - state.lastValidationAt < 1200) return;
    state.lastValidationAt = now;
    const validation = buildValidationSummary(form);
    emitFormLifecycle(form, 'form_submit_validation_failed', {
        form_trigger: trigger,
        form_validation: validation
    });
    for (let i = pendingFormAttempts.length - 1; i >= 0; i -= 1) {
        const item = pendingFormAttempts[i];
        if (item?.form === form && !item.resolved) {
            item.resolved = true;
        }
    }
    cleanupPendingForms(now);
}

function trackFormAttempt(form, trigger = 'submit') {
    const state = getFormLifecycleState(form);
    if (!state) return null;
    const now = Date.now();
    if (now - state.lastAttemptAt < 900) return null;
    state.lastAttemptAt = now;
    trackFormStart(form, 'attempt');
    const intentMeta = emitFormLifecycle(form, 'form_submit_attempt', {
        form_trigger: trigger
    });
    if (!intentMeta) return null;
    const pending = registerPendingFormAttempt(form, intentMeta, {
        form_trigger: trigger
    });
    const validation = buildValidationSummary(form);
    if (validation.invalid_field_count > 0) {
        trackFormValidationFailure(form, trigger);
        pending.resolved = true;
    }
    cleanupPendingForms(now);
    return pending;
}

function looksLikeSuccessLocation() {
    const text = [
        window.location.href,
        document.title || '',
        document.body?.innerText?.slice(0, 4000) || ''
    ].join(' ').toLowerCase();
    return [
        'thank you',
        'thanks',
        'tesekkur',
        'teşekkür',
        'basarili',
        'başarılı',
        'gonderildi',
        'gönderildi',
        'success',
        'completed'
    ].some((token) => text.includes(token));
}

function flushPendingNavigationOutcome() {
    let raw = null;
    try {
        raw = sessionStorage.getItem(FORM_PENDING_STORAGE_KEY);
        sessionStorage.removeItem(FORM_PENDING_STORAGE_KEY);
    } catch {
        raw = null;
    }
    if (!raw) return;
    let pending = null;
    try {
        pending = JSON.parse(raw);
    } catch {
        pending = null;
    }
    if (!pending || !pending.intentTarget || !pending.intentPageUrl || !pending.formSummary) return;
    if (Date.now() - Number(pending.createdAt || 0) > 45000) return;
    const sourcePath = (() => {
        try {
            return new URL(pending.intentPageUrl).pathname || '/';
        } catch {
            return '';
        }
    })();
    const currentPath = (() => {
        try {
            return new URL(window.location.href).pathname || '/';
        } catch {
            return '';
        }
    })();
    if (currentPath && sourcePath && currentPath !== sourcePath || looksLikeSuccessLocation()) {
        sendEvent('conversion', 'form_submit_success', pending.intentTarget, null, {
            intent_action: 'form',
            intent_target: pending.intentTarget,
            intent_page_url: pending.intentPageUrl,
            form_stage: 'submit_success',
            form_summary: pending.formSummary,
            form_transport: 'navigation'
        });
    }
}

function stashPendingNavigationAttempt() {
    cleanupPendingForms();
    const pending = pendingFormAttempts.find((item) => item && !item.resolved);
    if (!pending) return;
    try {
        sessionStorage.setItem(FORM_PENDING_STORAGE_KEY, JSON.stringify({
            intentTarget: pending.intentTarget,
            intentPageUrl: pending.intentPageUrl,
            formSummary: pending.formSummary,
            createdAt: pending.createdAt
        }));
    } catch {
        // ignore storage failures
    }
}

function pickPendingTransport(url, method) {
    cleanupPendingForms();
    const requestMethod = String(method || 'GET').trim().toUpperCase();
    if (requestMethod === 'GET') return null;
    const requestPath = (() => {
        try {
            return new URL(url, window.location.href).pathname || '/';
        } catch {
            return '';
        }
    })();
    const now = Date.now();
    const candidates = pendingFormAttempts.filter((item) => item && !item.resolved && now - item.createdAt < 15000);
    for (const item of candidates.reverse()) {
        if (item.actionPath && requestPath && item.actionPath === requestPath) return item;
    }
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

function installFormTransportHooks() {
    if (window.__opsmantikFormTransportHooksInstalled) return;
    window.__opsmantikFormTransportHooksInstalled = true;

    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
        window.fetch = function (...args) {
            const input = args[0];
            const init = args[1] || {};
            const url = typeof input === 'string' ? input : (input?.url || window.location.href);
            const method = init?.method || input?.method || 'GET';
            const pending = pickPendingTransport(url, method);
            return originalFetch.apply(this, args)
                .then((response) => {
                    if (pending) {
                        resolvePendingForm(
                            pending,
                            response.ok ? 'form_submit_success' : 'form_submit_network_failed',
                            {
                                form_transport: 'fetch',
                                form_http_status: response.status
                            }
                        );
                    }
                    return response;
                })
                .catch((error) => {
                    if (pending) {
                        resolvePendingForm(pending, 'form_submit_network_failed', {
                            form_transport: 'fetch',
                            form_error: String(error?.message || error || 'fetch_failed').slice(0, 120)
                        });
                    }
                    throw error;
                });
        };
    }

    const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (proto && !proto.__opsmantikWrapped) {
        const originalOpen = proto.open;
        const originalSend = proto.send;
        proto.open = function (method, url, ...rest) {
            this.__opsmantikMethod = method;
            this.__opsmantikUrl = url;
            return originalOpen.call(this, method, url, ...rest);
        };
        proto.send = function (...args) {
            const pending = pickPendingTransport(this.__opsmantikUrl || window.location.href, this.__opsmantikMethod || 'GET');
            if (pending) {
                this.addEventListener('load', () => {
                    resolvePendingForm(
                        pending,
                        this.status >= 200 && this.status < 400 ? 'form_submit_success' : 'form_submit_network_failed',
                        {
                            form_transport: 'xhr',
                            form_http_status: this.status
                        }
                    );
                }, { once: true });
                this.addEventListener('error', () => {
                    resolvePendingForm(pending, 'form_submit_network_failed', {
                        form_transport: 'xhr',
                        form_error: 'xhr_error'
                    });
                }, { once: true });
                this.addEventListener('abort', () => {
                    resolvePendingForm(pending, 'form_submit_network_failed', {
                        form_transport: 'xhr',
                        form_error: 'xhr_abort'
                    });
                }, { once: true });
            }
            return originalSend.apply(this, args);
        };
        proto.__opsmantikWrapped = true;
    }
}

function emitTrackedIntent(target, eventAction, label, source, element = null) {
    const intentMeta = buildCallIntentMeta(target);
    const dedupeKey = `${intentMeta.intentAction}|${intentMeta.intentTarget}`;
    const now = Date.now();
    cleanupRecentIntentWindow(now);
    const lastTrackedAt = recentTrackedIntentAt.get(dedupeKey) || 0;
    if (now - lastTrackedAt < 1800) {
        if (isTrackerDebugEnabled()) {
            console.log('[OPSMANTIK][intent] deduped', {
                action: intentMeta.intentAction,
                target: intentMeta.intentTarget,
                source
            });
        }
        return false;
    }
    recentTrackedIntentAt.set(dedupeKey, now);
    if (isTrackerDebugEnabled()) {
        console.log('[OPSMANTIK][intent] captured', {
            action: intentMeta.intentAction,
            target: intentMeta.intentTarget,
            source
        });
    }
    sendEvent('conversion', eventAction, label, null, {
        intent_stamp: intentMeta.intentStamp,
        intent_action: intentMeta.intentAction,
        intent_target: intentMeta.intentTarget,
        intent_page_url: intentMeta.intentPageUrl,
        intent_source: source,
        ...(element?.id ? { intent_element_id: element.id } : {})
    });
    sendCallEvent(target, intentMeta);
    return true;
}

function extractPhoneIntentFromElement(clickTarget, composedPath = []) {
    const selector = 'a[href], [data-om-phone], [data-phone], [data-tel], [onclick], [data-href]';

    const tryExtractFromNode = (node) => {
        if (!node || typeof node !== 'object') return null;
        const el = node?.matches?.(selector)
            ? node
            : (node?.closest ? node.closest(selector) : null);
        if (!el) return null;

        const hrefAttr = typeof el.getAttribute === 'function' ? (el.getAttribute('href') || '') : '';
        const hrefProp = typeof el.href === 'string' ? el.href : '';
        const dataHref = typeof el.getAttribute === 'function' ? (el.getAttribute('data-href') || '') : '';
        const dataPhone = typeof el.getAttribute === 'function'
            ? (el.getAttribute('data-om-phone') || el.getAttribute('data-phone') || el.getAttribute('data-tel') || '')
            : '';
        const onClickAttr = typeof el.getAttribute === 'function' ? (el.getAttribute('onclick') || '') : '';
        const telFromOnClick = (() => {
            const m = onClickAttr.match(/tel:[^'"\\)\s]+/i);
            return m ? m[0] : '';
        })();

        const pickTelLike = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            if (raw.toLowerCase().startsWith('tel:')) return raw;
            return '';
        };

        const candidate =
            pickTelLike(hrefAttr) ||
            pickTelLike(hrefProp) ||
            pickTelLike(dataHref) ||
            (dataPhone ? (dataPhone.toLowerCase().startsWith('tel:') ? dataPhone : `tel:${dataPhone}`) : '') ||
            telFromOnClick;

        if (!candidate || !candidate.toLowerCase().startsWith('tel:')) return null;
        return { target: candidate, element: el };
    };

    for (const node of composedPath) {
        const match = tryExtractFromNode(node);
        if (match) return match;
    }

    return tryExtractFromNode(clickTarget);
}

function installOutboundIntentHooks() {
    if (window.__opsmantikIntentHooksInstalled) return;
    window.__opsmantikIntentHooksInstalled = true;

    document.addEventListener('pointerdown', (e) => {
        const el = e.target && e.target.closest
            ? e.target.closest('[data-om-whatsapp], a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="joinchat"], a[href^="whatsapp://"], a[href^="whatsapp:"], [class*="joinchat"], [class*="jivo"], [id*="jivo"]')
            : null;
        if (!el) return;
        lastPointerContext = {
            ts: Date.now(),
            element: el
        };
    }, true);

    const originalOpen = window.open;
    if (typeof originalOpen === 'function') {
        window.open = function (...args) {
            const target = typeof args[0] === 'string' ? args[0] : '';
            if (target && shouldTrackWhatsAppTarget(target)) {
                const recentElement = lastPointerContext && Date.now() - lastPointerContext.ts < 2000
                    ? lastPointerContext.element
                    : null;
                emitTrackedIntent(target, 'whatsapp', target, inferWidgetSource(target, recentElement), recentElement);
            } else if (target && String(target).toLowerCase().startsWith('tel:')) {
                emitTrackedIntent(target, 'phone_call', target, 'window_open');
            }
            return originalOpen.apply(this, args);
        };
    }

    // Some sites launch dial intent via location.assign/replace instead of anchor/window.open.
    try {
        const wrapLocationMethod = (name) => {
            const fn = window.location && window.location[name];
            if (typeof fn !== 'function') return;
            if (fn.__opsmantikWrapped) return;
            const wrapped = function (...args) {
                const target = typeof args[0] === 'string' ? args[0] : '';
                if (target && String(target).toLowerCase().startsWith('tel:')) {
                    emitTrackedIntent(target, 'phone_call', target, `location_${name}`);
                }
                return fn.apply(window.location, args);
            };
            wrapped.__opsmantikWrapped = true;
            window.location[name] = wrapped;
        };
        wrapLocationMethod('assign');
        wrapLocationMethod('replace');
    } catch {
        // ignore location patch failures on strict browsers
    }
}

export function sendCallEvent(phoneNumber, intentMeta = null) {
    if (!siteId) return;
    const session = getOrCreateSession();
    // Derive call-event URL from sync API (data-api or console default)
    const base = CONFIG.apiUrl ? CONFIG.apiUrl.replace(/\/api\/sync\/?$/, '') : window.location.origin;
    const callEventUrl = base + '/api/call-event/v2';
    const scriptTag = getTrackerScriptTag();

    const proxyUrl = scriptTag?.getAttribute('data-ops-proxy-url') || (window.opsmantikConfig || window.opmantikConfig || {})?.opsProxyUrl || '';
    const eventId = generateUUID();
    const adsCtx = getAdsContext();
    const resolvedIntent = intentMeta || buildCallIntentMeta(phoneNumber);
    const payloadObj = {
        event_id: eventId,
        site_id: siteId,
        phone_number: resolvedIntent.intentTarget,
        fingerprint: session.fingerprint,
        action: resolvedIntent.intentAction,
        intent_action: resolvedIntent.intentAction,
        intent_target: resolvedIntent.intentTarget,
        intent_stamp: resolvedIntent.intentStamp,
        intent_page_url: resolvedIntent.intentPageUrl,
        url: window.location.href,
        ua: navigator.userAgent,
        gclid: session.context,
        wbraid: session.wbraid,
        gbraid: session.gbraid
    };
    if (adsCtx) payloadObj.ads_context = adsCtx;
    const payload = JSON.stringify(payloadObj);

    if (proxyUrl) {
        fetch(proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true })
            .then((res) => {
                if (!res.ok) {
                    console.warn('[OpsMantik] proxied call-event rejected', {
                        status: res.status,
                        intentAction: payloadObj.intent_action,
                        siteId
                    });
                } else if (isTrackerDebugEnabled()) {
                    console.log('[OPSMANTIK][call-event] proxied send ok', {
                        status: res.status,
                        intentAction: payloadObj.intent_action
                    });
                }
            })
            .catch(function (e) {
                if (typeof console !== 'undefined') console.warn('[OpsMantik] TRACKER_FETCH_FAILED', 'call-event', e?.message || e);
            });
        return;
    }

    // HMAC-SHA256 signed V1 flow
    const secret = scriptTag?.getAttribute('data-ops-secret') || (window.opsmantikConfig || window.opmantikConfig || {})?.opsSecret || '';
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
            .then((res) => {
                if (res && !res.ok && typeof console !== 'undefined') {
                    console.warn('[OpsMantik] signed call-event rejected', {
                        status: res.status,
                        siteId,
                        hasSecret: Boolean(secret),
                        hasProxyUrl: Boolean(proxyUrl),
                        callEventUrl
                    });
                }
            })
            .catch((err) => {
                console.warn('[OpsMantik] signed call-event send failed', {
                    message: String(err?.message || err || 'unknown_error'),
                    intentAction: payloadObj.intent_action,
                    siteId
                });
            });
        return;
    }

    if (typeof console !== 'undefined') {
        console.warn('[OpsMantik] call-event sent unsigned: missing proxyUrl or signing secret');
    }
    fetch(callEventUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
    }).catch(function (err) {
        console.warn('[OpsMantik] unsigned call-event send failed', {
            message: String(err?.message || err || 'unknown_error'),
            intentAction: payloadObj.intent_action,
            siteId
        });
    });
}

// sendPageViewPulse was removed along with the /api/track/pv endpoint (now 410 Gone).
// PV telemetry is now covered by the canonical sendEvent('interaction', 'view', ...) call
// through /api/sync. Preserved as a no-op to keep old bundled integrations quiet until
// they cycle to the next tracker version.
function sendPageViewPulse() {
    return;
}

export function initAutoTracking() {
    console.log('[OPSMANTIK] Auto-tracking initialized');
    sendEvent('interaction', 'view', document.title);
    sendPageViewPulse();
    installOutboundIntentHooks();
    if (ENABLE_FORM_TRACKING) {
        installFormTransportHooks();
        flushPendingNavigationOutcome();
    }

    const handleIntentClick = (e) => {
        try {
        const anchor = e.target.closest && e.target.closest('a[href]');
        if (anchor) {
            const anchorHref = String(anchor.getAttribute('href') || anchor.href || '').trim();
            if (anchorHref.toLowerCase().startsWith('tel:')) {
                emitTrackedIntent(anchorHref, 'phone_call', anchorHref, 'phone', anchor);
                return;
            }
        }
        const phoneIntent = extractPhoneIntentFromElement(
            e.target,
            typeof e.composedPath === 'function' ? e.composedPath() : []
        );
        if (phoneIntent) {
            emitTrackedIntent(phoneIntent.target, 'phone_call', phoneIntent.target, 'phone', phoneIntent.element);
            return;
        }
        const dataWa = e.target.closest && e.target.closest('[data-om-whatsapp]');
        if (dataWa && dataWa.getAttribute('data-om-whatsapp')) {
            const href = dataWa.getAttribute('data-om-whatsapp');
            emitTrackedIntent(href, 'whatsapp', href, inferWidgetSource(href, dataWa), dataWa);
        } else {
            const wa = e.target.closest('a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="joinchat"], a[href^="whatsapp://"], a[href^="whatsapp:"]');
            if (wa) {
                emitTrackedIntent(wa.href, 'whatsapp', wa.href, inferWidgetSource(wa.href, wa), wa);
            }
        }
        } catch (err) {
            console.warn('[OPSMANTIK] intent click handler error', {
                message: String(err?.message || err || 'unknown_error'),
                targetTag: e?.target?.tagName || null
            });
        }
    };
    // Capture phase improves reliability for tel links that stop propagation or trigger rapid external navigation.
    // Some mobile stacks may skip click when external tel protocol launches fast; pointer/touch catch this earlier.
    document.addEventListener('click', handleIntentClick, true);
    document.addEventListener('pointerdown', handleIntentClick, true);
    document.addEventListener('touchstart', handleIntentClick, true);

    if (ENABLE_FORM_TRACKING) {
        document.addEventListener('submit', (e) => {
            if (e.target.tagName === 'FORM') {
                trackFormAttempt(e.target, 'submit');
            }
        }, true);

        document.addEventListener('focusin', (e) => {
            const form = e.target?.closest?.('form');
            if (form) trackFormStart(form, 'focus');
        }, true);

        document.addEventListener('input', (e) => {
            const form = e.target?.closest?.('form');
            if (form) trackFormStart(form, 'input');
        }, true);

        document.addEventListener('invalid', (e) => {
            const form = e.target?.closest?.('form');
            if (form) {
                trackFormStart(form, 'invalid');
                trackFormValidationFailure(form, 'invalid');
            }
        }, true);

        const formProto = window.HTMLFormElement && window.HTMLFormElement.prototype;
        if (formProto && !formProto.__opsmantikWrapped) {
            const originalRequestSubmit = formProto.requestSubmit;
            const originalNativeSubmit = formProto.submit;
            if (typeof originalRequestSubmit === 'function') {
                formProto.requestSubmit = function (...args) {
                    trackFormAttempt(this, 'request_submit');
                    return originalRequestSubmit.apply(this, args);
                };
            }
            if (typeof originalNativeSubmit === 'function') {
                formProto.submit = function (...args) {
                    trackFormAttempt(this, 'native_submit');
                    return originalNativeSubmit.apply(this, args);
                };
            }
            formProto.__opsmantikWrapped = true;
        }
    }

    window.addEventListener('scroll', () => {
        const doc = document.documentElement;
        const scrollPercent = Math.round(((window.scrollY + window.innerHeight) / doc.scrollHeight) * 100);
        if (scrollPercent > pulse.maxScroll) {
            pulse.maxScroll = scrollPercent;
            // Send scroll thresholds only once per session (prevents spam/quota burn).
            if (!pulse.sentScroll50 && scrollPercent >= 50) {
                pulse.sentScroll50 = true;
                sendEvent('interaction', 'scroll_depth', '50%', scrollPercent);
            }
            if (!pulse.sentScroll90 && scrollPercent >= 90) {
                pulse.sentScroll90 = true;
                sendEvent('interaction', 'scroll_depth', '90%', scrollPercent);
            }
        }
    });

    document.addEventListener('mouseenter', (e) => {
        const cta = e.target.closest && e.target.closest('a[href^="tel:"], a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="joinchat"], a[href^="whatsapp://"], a[href^="whatsapp:"], [data-om-whatsapp], [data-om-cta="true"]');
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
        if (ENABLE_FORM_TRACKING) {
            stashPendingNavigationAttempt();
        }
        sendEvent('system', 'session_end', 'page_unload', null, { exit_page: window.location.href });
        lastGaspFlush();
    });
}

// Global exposure and init (P0-2: single init guard)
function initTracker() {
    if (window.__opsmantikTrackerInitialized) {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('opsmantik_debug') === '1') {
            console.warn('[OPSMANTIK_DEBUG] tracker init skipped (duplicate)', { ts: Date.now() });
        }
        return;
    }
    window.__opsmantikTrackerInitialized = true;
    window.opsmantik = {
        send: sendEvent,
        session: getOrCreateSession,
        _initialized: true,
    };
    // Backward compatibility for legacy installations using window.opmantik
    window.opmantik = window.opsmantik;

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
if (typeof window !== 'undefined') initTracker();
