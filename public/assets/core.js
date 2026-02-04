// OPSMANTIK CORE — do not rename without updating docs
// Neutral path for ad-blocker avoidance: /assets/core.js
// Legacy path: /ux-core.js (kept for backwards compatibility)

(function () {
  'use strict';

  // Prevent duplicate initialization
  if (window.opmantik && window.opmantik._initialized) {
    console.warn('[OPSMANTIK] Tracker already initialized, skipping...');
    return;
  }

  // Get site ID and API URL from script tag (LiteSpeed/deferred load: currentScript can be null)
  const scriptTag = document.currentScript || document.querySelector('script[data-site-id]');
  let siteId = scriptTag?.getAttribute('data-site-id') || '';
  if (!siteId && typeof window !== 'undefined' && window.opmantikConfig && window.opmantikConfig.siteId) {
    siteId = String(window.opmantikConfig.siteId);
  }
  if (!siteId) {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      var src = (s.src || '').toLowerCase();
      if ((src.indexOf('core.js') !== -1 || src.indexOf('ux-core.js') !== -1) && s.getAttribute('data-site-id')) {
        siteId = s.getAttribute('data-site-id') || '';
        break;
      }
    }
  }

  // Determine API endpoint with priority:
  // A) data-api attribute (if present)
  // B) localhost/127.0.0.1 -> window.location.origin + "/api/sync"
  // C) production default -> "https://console.opsmantik.com/api/sync"
  let apiUrl;
  let apiSource;

  const dataApi = scriptTag?.getAttribute('data-api');
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('127.0.0.1:') || hostname.startsWith('localhost:');

  if (dataApi) {
    apiUrl = dataApi;
    apiSource = 'data-api';
  } else if (isLocalhost) {
    apiUrl = window.location.origin + '/api/sync';
    apiSource = 'local';
  } else {
    apiUrl = 'https://console.opsmantik.com/api/sync';
    apiSource = 'prod-default';
  }

  // Configuration
  const CONFIG = {
    apiUrl: apiUrl,
    sessionKey: 'opmantik_session_sid',
    fingerprintKey: 'opmantik_session_fp',
    contextKey: 'opmantik_session_context',
    heartbeatInterval: 60000, // 60 seconds
    sessionTimeout: 1800000, // 30 minutes
  };

  // Log chosen API URL with source
  if (typeof window !== 'undefined') {
    console.log('[OPSMANTIK] API URL (' + apiSource + '):', CONFIG.apiUrl);
  }

  if (!siteId) {
    console.warn('[OPSMANTIK] ❌ Site ID not found');
    return;
  }

  console.log('[OPSMANTIK] ✅ Tracker initializing for site:', siteId);

  // Fingerprint generation
  function generateFingerprint() {
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

    // Simple hash
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  // UUID v4 generator (RFC 4122 compliant)
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Intent stamp helpers (Phase 1)
  function rand4() {
    return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  }

  function hash6(str) {
    const s = (str || '').toString();
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    const out = Math.abs(h).toString(36);
    return out.slice(0, 6).padEnd(6, '0');
  }

  // Hardware DNA + Network (backend: meta.lan, mem, con, sw, sh, dpr, gpu, con_type)
  function getHardwareMeta() {
    const o = {};
    try { if (navigator.language) o.lan = navigator.language; } catch (e) {}
    try { if (typeof navigator.deviceMemory === 'number') o.mem = navigator.deviceMemory; } catch (e) {}
    try { if (typeof navigator.hardwareConcurrency === 'number') o.con = navigator.hardwareConcurrency; } catch (e) {}
    try { if (typeof screen !== 'undefined') { o.sw = screen.width; o.sh = screen.height; } } catch (e) {}
    try { if (typeof window.devicePixelRatio === 'number') o.dpr = window.devicePixelRatio; } catch (e) {}
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) { const r = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); if (r) o.gpu = r; }
      }
    } catch (e) {}
    try {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn && conn.effectiveType) o.con_type = conn.effectiveType;
    } catch (e) {}
    return o;
  }

  function makeIntentStamp(actionShort, target) {
    const ts = Date.now();
    const tHash = hash6((target || '').toString().toLowerCase());
    return `${ts}-${rand4()}-${actionShort}-${tHash}`;
  }

  // Intent Pulse (Prompt 2.1)
  const pulse = {
    maxScroll: 0,
    ctaHovers: 0,
    focusDur: 0,
    activeSec: 0,
    lastActiveAt: Date.now(),
  };
  function getPulseMeta() {
    const o = {};
    if (pulse.maxScroll > 0) o.scroll_pct = Math.min(100, pulse.maxScroll);
    if (pulse.ctaHovers > 0) o.cta_hovers = pulse.ctaHovers;
    if (pulse.focusDur > 0) o.focus_dur = pulse.focusDur;
    if (pulse.activeSec > 0) o.active_sec = pulse.activeSec;
    return o;
  }

  // Session management
  function getOrCreateSession() {
    let sessionId = sessionStorage.getItem(CONFIG.sessionKey);
    let fingerprint = localStorage.getItem(CONFIG.fingerprintKey);
    let context = sessionStorage.getItem(CONFIG.contextKey);

    if (!fingerprint) {
      fingerprint = generateFingerprint();
      localStorage.setItem(CONFIG.fingerprintKey, fingerprint);
      console.log('[OPSMANTIK] Generated fingerprint:', fingerprint);
    }

    // Validate existing sessionId is UUID format, regenerate if not
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (sessionId && !uuidRegex.test(sessionId)) {
      // Old format detected, migrate to UUID
      console.log('[OPSMANTIK] Migrating session ID to UUID format');
      sessionId = null;
      sessionStorage.removeItem(CONFIG.sessionKey);
    }

    if (!sessionId) {
      sessionId = generateUUID();
      sessionStorage.setItem(CONFIG.sessionKey, sessionId);
      console.log('[OPSMANTIK] Created new session:', sessionId);
    }

    // Extract GCLID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const gclid = urlParams.get('gclid') || context;
    if (gclid) {
      sessionStorage.setItem(CONFIG.contextKey, gclid);
      context = gclid;
      console.log('[OPSMANTIK] GCLID detected:', gclid);
    }

    return { sessionId, fingerprint, context };
  }

  /* --- SECTOR BRAVO: STORE & FORWARD ENGINE (Tank Tracker) --- */

  const QUEUE_KEY = 'opsmantik_outbox_v2';

  function getQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch (e) { return []; }
  }

  function saveQueue(queue) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (e) { /* Quota exceeded or private mode */ }
  }

  function addToOutbox(payload) {
    const queue = getQueue();
    const envelopeId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : generateUUID();
    const envelope = { id: envelopeId, ts: Date.now(), payload: payload, attempts: 0 };
    queue.push(envelope);
    if (queue.length > 100) queue.splice(0, queue.length - 80);
    saveQueue(queue);
    processOutbox();
  }

  let isProcessing = false;

  async function processOutbox() {
    if (isProcessing) return;
    const queue = getQueue();
    if (queue.length === 0) return;
    isProcessing = true;
    const currentEnvelope = queue[0];
    try {
      if (currentEnvelope.attempts > 10 && (Date.now() - currentEnvelope.ts > 86400000)) {
        queue.shift();
        saveQueue(queue);
        isProcessing = false;
        processOutbox();
        return;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(function () { controller.abort(); }, 5000);
      const syncUrl = new URL(CONFIG.apiUrl);
      syncUrl.searchParams.set('_ts', Date.now().toString());
      const response = await fetch(syncUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentEnvelope.payload),
        keepalive: true,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        queue.shift();
        saveQueue(queue);
        if (localStorage.getItem('opsmantik_debug') === '1') {
          console.log('[TankTracker] Delivered:', currentEnvelope.payload.ea);
        }
        isProcessing = false;
        processOutbox();
      } else {
        throw new Error('Server status: ' + response.status);
      }
    } catch (err) {
      console.warn('[TankTracker] Network Fail - Retrying later:', err.message);
      currentEnvelope.attempts++;
      saveQueue(queue);
      isProcessing = false;
      setTimeout(processOutbox, 5000);
    }
  }

  function sendEvent(category, action, label, value, metadata) {
    if (metadata === undefined) metadata = {};
    const session = getOrCreateSession();
    const sessionId = session.sessionId;
    const fingerprint = session.fingerprint;
    const context = session.context;
    const url = window.location.href;
    const referrer = document.referrer || '';
    const sessionMonth = new Date().toISOString().slice(0, 7) + '-01';
    const meta = { fp: fingerprint, gclid: context, ...getHardwareMeta() };
    if (scriptTag) {
      var dc = scriptTag.getAttribute('data-geo-city');
      var dd = scriptTag.getAttribute('data-geo-district');
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
    for (const k in metadata) { if (Object.prototype.hasOwnProperty.call(metadata, k)) meta[k] = metadata[k]; }
    const payload = {
      s: siteId,
      u: url,
      sid: sessionId,
      sm: sessionMonth,
      ec: category,
      ea: action,
      el: label,
      ev: value,
      r: referrer,
      meta,
    };
    if (localStorage.getItem('opsmantik_debug') === '1') {
      console.log('[OPSMANTIK] Outbox:', category + '/' + action, sessionId.slice(0, 8) + '...');
    } else {
      console.log('[OPSMANTIK] Sending event:', { category, action, label, value, sessionId: sessionId.slice(0, 8) + '...' });
    }
    addToOutbox(payload);
  }

  // Auto-tracking
  function initAutoTracking() {
    console.log('[OPSMANTIK] Auto-tracking initialized');

    // Page view
    sendEvent('interaction', 'view', document.title);

    // Phone links
    document.addEventListener('click', (e) => {
      const target = e.target.closest('a[href^="tel:"]');
      if (target) {
        const intent_stamp = makeIntentStamp('tel', target.href);
        sendEvent('conversion', 'phone_call', target.href, null, {
          intent_stamp,
          intent_action: 'phone_call',
        });
      }
    });

    // WhatsApp links
    document.addEventListener('click', (e) => {
      const target = e.target.closest('a[href*="wa.me"], a[href*="whatsapp.com"]');
      if (target) {
        const intent_stamp = makeIntentStamp('wa', target.href);
        sendEvent('conversion', 'whatsapp', target.href, null, {
          intent_stamp,
          intent_action: 'whatsapp',
        });
      }
    });

    // Form submissions
    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (form.tagName === 'FORM') {
        sendEvent('conversion', 'form_submit', form.id || form.name || 'form');
      }
    });

    // Scroll depth (Intent Pulse)
    window.addEventListener('scroll', () => {
      const doc = document.documentElement;
      const scrollPercent = Math.round(((window.scrollY + window.innerHeight) / doc.scrollHeight) * 100);
      if (scrollPercent > pulse.maxScroll) {
        pulse.maxScroll = scrollPercent;
        if (scrollPercent >= 50 && scrollPercent < 90) {
          sendEvent('interaction', 'scroll_depth', '50%', scrollPercent);
        } else if (scrollPercent >= 90) {
          sendEvent('interaction', 'scroll_depth', '90%', scrollPercent);
        }
      }
    });

    // CTA hover count (Intent Pulse)
    document.addEventListener('mouseenter', (e) => {
      const t = e.target.closest && e.target.closest('a[href^="tel:"], a[href*="wa.me"], a[href*="whatsapp.com"], [data-om-cta="true"]');
      if (t) pulse.ctaHovers += 1;
    }, true);

    // Form focus duration (Intent Pulse)
    let focusStart = 0;
    document.addEventListener('focusin', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) {
        focusStart = Date.now();
      }
    });
    document.addEventListener('focusout', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') && focusStart > 0) {
        pulse.focusDur += Math.round((Date.now() - focusStart) / 1000);
        focusStart = 0;
      }
    });

    // Active seconds (Intent Pulse)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        pulse.activeSec += Math.round((Date.now() - pulse.lastActiveAt) / 1000);
      } else {
        pulse.lastActiveAt = Date.now();
      }
    });

    // Heartbeat
    setInterval(() => {
      sendEvent('system', 'heartbeat', 'session_active');
    }, CONFIG.heartbeatInterval);

    // Session end (flush active before send)
    window.addEventListener('beforeunload', () => {
      pulse.activeSec += Math.round((Date.now() - pulse.lastActiveAt) / 1000);
      sendEvent('system', 'session_end', 'page_unload', null, {
        exit_page: window.location.href,
      });
    });
  }

  // Public API
  window.opmantik = {
    send: sendEvent,
    session: getOrCreateSession,
    _initialized: true,
  };

  // 4. Initialization — process outbox on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      processOutbox();
      initAutoTracking();
    });
  } else {
    processOutbox();
    initAutoTracking();
  }

  window.addEventListener('online', processOutbox);

  window.addEventListener('beforeunload', function () {
    const queue = getQueue();
    if (queue.length > 0 && navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.apiUrl, new Blob([JSON.stringify(queue[0].payload)], { type: 'application/json' }));
    }
  });
})();
