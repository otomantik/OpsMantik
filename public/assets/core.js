// OPSMANTIK CORE — do not rename without updating docs
// Neutral path for ad-blocker avoidance: /assets/core.js
// Legacy path: /ux-core.js (kept for backwards compatibility)

(function () {
  'use strict';

  // P0-2: Prevent duplicate initialization (single guard, no second heartbeat/outbox/autotracking)
  if (window.__opsmantikTrackerInitialized) {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('opsmantik_debug') === '1') {
      console.warn('[OPSMANTIK_DEBUG] tracker init skipped (duplicate)', { ts: Date.now() });
    }
    return;
  }

  // Get site ID and API URL from script tag (LiteSpeed/deferred load: currentScript can be null)
  // Preferred attribute: data-ops-site-id (V2). Back-compat: data-site-id.
  const scriptTag = document.currentScript || document.querySelector('script[data-ops-site-id], script[data-site-id]');
  let siteId = scriptTag?.getAttribute('data-ops-site-id') || scriptTag?.getAttribute('data-site-id') || '';
  if (!siteId && typeof window !== 'undefined') {
    const cfg = window.opsmantikConfig || window.opmantikConfig;
    if (cfg && cfg.siteId) siteId = String(cfg.siteId);
  }
  if (!siteId) {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      var src = (s.src || '').toLowerCase();
      if ((src.indexOf('core.js') !== -1 || src.indexOf('ux-core.js') !== -1) && (s.getAttribute('data-ops-site-id') || s.getAttribute('data-site-id'))) {
        siteId = s.getAttribute('data-ops-site-id') || s.getAttribute('data-site-id') || '';
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

  // Configuration (storage keys: opsmantik_* for correct brand spelling)
  const CONFIG = {
    apiUrl: apiUrl,
    sessionKey: 'opsmantik_session_sid',
    fingerprintKey: 'opsmantik_session_fp',
    contextKey: 'opsmantik_session_context',
    contextWbraidKey: 'opsmantik_session_wbraid',
    contextGbraidKey: 'opsmantik_session_gbraid',
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
  window.__opsmantikTrackerInitialized = true;
  console.log('[OPSMANTIK] ✅ Tracker initializing for site:', siteId);
  if (localStorage.getItem('opsmantik_debug') === '1') {
    console.log('[OPSMANTIK_DEBUG] tracker init', { siteId: siteId, ts: Date.now() });
  }

  // --- Autonomous Consent Sniffer (Zero-Config CMP Integration) ---
  var trackerConsentScopes = ['analytics'];

  function updateTrackerConsent(scopes) {
    try {
      if (!Array.isArray(scopes)) return;
      var valid = [];
      for (var i = 0; i < scopes.length; i++) {
        var s = String(scopes[i]).toLowerCase();
        if (s === 'analytics' || s === 'marketing') valid.push(s);
      }
      trackerConsentScopes = valid.length > 0 ? valid : [];
      if (localStorage.getItem('opsmantik_debug') === '1') {
        console.log('[OPSMANTIK_DEBUG] consent updated', { scopes: trackerConsentScopes });
      }
    } catch (e) { /* defensive */ }
  }

  function initConsentSniffer() {
    try {
      if (typeof window === 'undefined') return;
      var w = window;
      var scriptCfg = w.opsmantikConfig || w.opmantikConfig;
      var explicitConfig = scriptCfg && 'consentScopes' in scriptCfg;
      if (explicitConfig) {
        updateTrackerConsent(Array.isArray(scriptCfg.consentScopes) ? scriptCfg.consentScopes : []);
        return;
      }
      var dc = (scriptTag && scriptTag.getAttribute && scriptTag.getAttribute('data-ops-consent')) || '';
      if (dc) {
        var parts = dc.split(/[,\s]+/).map(function (p) { return (p || '').toLowerCase().trim(); });
        var sc = [];
        if (parts.indexOf('analytics') >= 0) sc.push('analytics');
        if (parts.indexOf('marketing') >= 0) sc.push('marketing');
        if (sc.length > 0) updateTrackerConsent(sc);
      }

      if (w.Cookiebot) {
        try {
          if (w.Cookiebot.consent) {
            var cb = [];
            if (w.Cookiebot.consent.statistics) cb.push('analytics');
            if (w.Cookiebot.consent.marketing) cb.push('marketing');
            updateTrackerConsent(cb.length > 0 ? cb : []);
          }
          w.addEventListener('CookiebotOnAccept', function () {
            try {
              var a = [];
              if (w.Cookiebot && w.Cookiebot.consent && w.Cookiebot.consent.statistics) a.push('analytics');
              if (w.Cookiebot && w.Cookiebot.consent && w.Cookiebot.consent.marketing) a.push('marketing');
              updateTrackerConsent(a.length > 0 ? a : []);
            } catch (e) { /* defensive */ }
          });
        } catch (e) { /* defensive */ }
        return;
      }

      if (typeof w.__tcfapi === 'function') {
        try {
          w.__tcfapi('addEventListener', 2, function (tcData, success) {
            if (!success || !tcData || (tcData.eventStatus !== 'tcloaded' && tcData.eventStatus !== 'useractioncomplete')) return;
            try {
              var pc = tcData.purposeConsents || {};
              var analytics = false;
              var marketing = false;
              if (typeof pc === 'string') {
                analytics = (pc[0] === '1') || (pc[6] === '1') || (pc[7] === '1');
                marketing = (pc[2] === '1') || (pc[3] === '1');
              } else {
                analytics = !!(pc[1] || pc[7] || pc[8]);
                marketing = !!(pc[3] || pc[4]);
              }
              var tcfScopes = [];
              if (analytics) tcfScopes.push('analytics');
              if (marketing) tcfScopes.push('marketing');
              updateTrackerConsent(tcfScopes.length > 0 ? tcfScopes : []);
            } catch (e) { /* defensive */ }
          });
        } catch (e) { /* defensive */ }
        return;
      }

      if (w.OnetrustActiveGroups) {
        try {
          var groups = String(w.OnetrustActiveGroups || '').split(',').map(function (g) { return (g || '').trim(); });
          var otScopes = [];
          if (groups.indexOf('C0002') >= 0) otScopes.push('analytics');
          if (groups.indexOf('C0004') >= 0) otScopes.push('marketing');
          updateTrackerConsent(otScopes.length > 0 ? otScopes : []);
        } catch (e) { /* defensive */ }
      }
      if (w.OneTrust && typeof w.OneTrust.OnConsentChanged === 'function') {
        try {
          w.OneTrust.OnConsentChanged(function () {
            try {
              var g = String(w.OnetrustActiveGroups || '').split(',').map(function (x) { return (x || '').trim(); });
              var s = [];
              if (g.indexOf('C0002') >= 0) s.push('analytics');
              if (g.indexOf('C0004') >= 0) s.push('marketing');
              updateTrackerConsent(s.length > 0 ? s : []);
            } catch (e) { /* defensive */ }
          });
        } catch (e) { /* defensive */ }
      }
    } catch (e) { /* defensive */ }
  }
  initConsentSniffer();

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
    try { if (navigator.language) o.lan = navigator.language; } catch (e) { }
    try { if (typeof navigator.deviceMemory === 'number') o.mem = navigator.deviceMemory; } catch (e) { }
    try { if (typeof navigator.hardwareConcurrency === 'number') o.con = navigator.hardwareConcurrency; } catch (e) { }
    try { if (typeof screen !== 'undefined') { o.sw = screen.width; o.sh = screen.height; } } catch (e) { }
    try { if (typeof window.devicePixelRatio === 'number') o.dpr = window.devicePixelRatio; } catch (e) { }
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) { const r = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); if (r) o.gpu = r; }
      }
    } catch (e) { }
    try {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn && conn.effectiveType) o.con_type = conn.effectiveType;
    } catch (e) { }
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
    sentScroll50: false,
    sentScroll90: false,
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

  // Build URLSearchParams from search + hash (e.g. #?utm_term=x)
  function getUrlParams() {
    var params = new URLSearchParams(window.location.search);
    if (window.location.hash) {
      var raw = window.location.hash.replace(/^#\??/, '');
      var afterQ = raw.indexOf('?') !== -1 ? raw.slice(raw.indexOf('?') + 1) : raw;
      if (afterQ.indexOf('=') !== -1) {
        try {
          var hashParams = new URLSearchParams(afterQ);
          hashParams.forEach(function (value, key) { params.set(key, value); });
        } catch (_) { }
      }
    }
    return params;
  }
  function getTemplateParams(params) {
    var p = function (k) { return params.get(k) || undefined; };
    return {
      utm_source: p('utm_source'), utm_medium: p('utm_medium'), utm_campaign: p('utm_campaign'),
      utm_adgroup: p('utm_adgroup'), utm_content: p('utm_content'), utm_term: p('utm_term'),
      device: p('device'), devicemodel: p('devicemodel'), targetid: p('targetid'), network: p('network'),
      adposition: p('adposition'), feeditemid: p('feeditemid'),
      loc_interest_ms: p('loc_interest_ms'), loc_physical_ms: p('loc_physical_ms'), matchtype: p('matchtype'),
    };
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

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (sessionId && !uuidRegex.test(sessionId)) {
      console.log('[OPSMANTIK] Migrating session ID to UUID format');
      sessionId = null;
      sessionStorage.removeItem(CONFIG.sessionKey);
    }

    if (!sessionId) {
      sessionId = generateUUID();
      sessionStorage.setItem(CONFIG.sessionKey, sessionId);
      console.log('[OPSMANTIK] Created new session:', sessionId);
    }

    var urlParams = getUrlParams();
    var gclid = urlParams.get('gclid') || context;
    var wbraid = urlParams.get('wbraid') || sessionStorage.getItem(CONFIG.contextWbraidKey);
    var gbraid = urlParams.get('gbraid') || sessionStorage.getItem(CONFIG.contextGbraidKey);
    if (gclid) {
      sessionStorage.setItem(CONFIG.contextKey, gclid);
      context = gclid;
    }
    if (wbraid) sessionStorage.setItem(CONFIG.contextWbraidKey, wbraid);
    if (gbraid) sessionStorage.setItem(CONFIG.contextGbraidKey, gbraid);

    var urlParamsObj = getTemplateParams(urlParams);
    return { sessionId: sessionId, fingerprint: fingerprint, context: context, wbraid: wbraid || null, gbraid: gbraid || null, urlParams: urlParamsObj };
  }

  /* --- SECTOR BRAVO: STORE & FORWARD ENGINE (Tank Tracker) --- */
  /* P0: Status-aware backoff with jitter to stop 429 retry storms */

  const QUEUE_KEY = 'opsmantik_outbox_v2';
  const DEAD_LETTER_KEY = 'opsmantik_dead_letters';
  const MAX_DEAD_LETTERS = 20;
  const JITTER_MS = 3000;
  const MAX_BATCH = 20;
  const MIN_FLUSH_INTERVAL_MS = 2000;
  const PAYLOAD_CAP_BYTES = 50 * 1024;
  const BATCH_RETRY_AFTER_MS = 5 * 60 * 1000;
  // Quota pause: when server returns 429 + x-opsmantik-quota-exceeded, stop retry storms.
  var quotaPausedUntil = 0;

  function appendDeadLetter(envelope, status) {
    try {
      var payload = envelope.payload || {};
      var ec = payload.ec;
      var ea = payload.ea;
      var attempts = envelope.attempts != null ? envelope.attempts : 0;
      var list = [];
      try {
        list = JSON.parse(localStorage.getItem(DEAD_LETTER_KEY) || '[]');
      } catch (_) { list = []; }
      list.push({ ts: Date.now(), status: status, ec: ec, ea: ea, attempts: attempts });
      if (list.length > MAX_DEAD_LETTERS) list = list.slice(-MAX_DEAD_LETTERS);
      localStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(list));
    } catch (_) { /* never break tracker */ }
  }

  function getRetryDelayMs(status, attempts) {
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
      return { delayMs: 0, retry: false };
    }
    var jitter = Math.floor(Math.random() * (JITTER_MS + 1));
    if (status === 429) {
      var base429 = Math.min(600000, Math.max(30000, 30000 * Math.pow(2, attempts)));
      return { delayMs: base429 + jitter, retry: true };
    }
    var base5xx = Math.min(120000, Math.max(5000, 5000 * Math.pow(2, attempts)));
    return { delayMs: base5xx + jitter, retry: true };
  }

  function parseStatusFromError(err) {
    if (err && typeof err.message === 'string') {
      var m = err.message.match(/Server status: (\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    return undefined;
  }

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
    // If quota is exceeded, avoid spamming the queue with low-value events.
    // Keep conversions so we can flush them after quota is lifted (temporary unblock or next month).
    if (quotaPausedUntil > Date.now() && payload && payload.ec !== 'conversion') {
      if (localStorage.getItem('opsmantik_debug') === '1') {
        console.warn('[OPSMANTIK_DEBUG] drop due to quota pause', { ec: payload.ec, ea: payload.ea, until: quotaPausedUntil });
      }
      return;
    }
    const queue = getQueue();
    const envelopeId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : generateUUID();
    const envelope = { id: envelopeId, ts: Date.now(), payload: payload, attempts: 0, nextAttemptAt: 0, lastStatus: undefined };
    queue.push(envelope);
    if (queue.length > 100) queue.splice(0, queue.length - 80);
    saveQueue(queue);
    if (localStorage.getItem('opsmantik_debug') === '1') {
      console.log('[OPSMANTIK_DEBUG] enqueue', { ea: payload.ea, ec: payload.ec, queueLength: queue.length });
    }
    processOutbox();
  }

  let isProcessing = false;
  var batchSupported = true;
  var batchRetryAt = 0;
  var lastFlushAt = 0;

  async function processOutbox() {
    if (isProcessing) return;
    var queue = getQueue();
    if (queue.length === 0) return;
    var currentEnvelope = queue[0];
    var nextAt = currentEnvelope.nextAttemptAt;
    var now = Date.now();
    if (quotaPausedUntil > now) {
      setTimeout(processOutbox, quotaPausedUntil - now);
      return;
    }
    if (nextAt != null && nextAt > 0 && nextAt > now) {
      var waitMs = nextAt - now;
      setTimeout(processOutbox, waitMs);
      return;
    }
    isProcessing = true;
    var batch = [];
    try {
      while (queue.length && queue[0].attempts > 10 && (now - (queue[0].ts || now)) > 86400000) {
        appendDeadLetter(queue[0], queue[0].lastStatus);
        queue.shift();
      }
      if (queue.length === 0) {
        saveQueue(queue);
        isProcessing = false;
        processOutbox();
        return;
      }
      saveQueue(queue);
      if (batchRetryAt > 0 && now >= batchRetryAt) {
        batchSupported = true;
        batchRetryAt = 0;
      }
      if (lastFlushAt > 0 && now - lastFlushAt < MIN_FLUSH_INTERVAL_MS) {
        var delayMsThrottle = lastFlushAt + MIN_FLUSH_INTERVAL_MS - now;
        isProcessing = false;
        if (localStorage.getItem('opsmantik_debug') === '1') {
          console.log('[OPSMANTIK_DEBUG] throttle scheduled', { delayMs: delayMsThrottle, lastFlushAt: lastFlushAt, now: now });
        }
        setTimeout(processOutbox, delayMsThrottle);
        return;
      }
      var maxBatch = batchSupported ? MAX_BATCH : 1;
      var payloadBytes = 0;
      for (var i = 0; i < queue.length && batch.length < maxBatch; i++) {
        var env = queue[i];
        if (env.nextAttemptAt != null && env.nextAttemptAt > 0 && env.nextAttemptAt > now) break;
        if (env.attempts > 10 && (now - (env.ts || now)) > 86400000) continue;
        var envSize = JSON.stringify(env.payload).length;
        var addSize = batch.length === 0 ? envSize : envSize + 2;
        if (payloadBytes + addSize > PAYLOAD_CAP_BYTES) break;
        batch.push(env);
        payloadBytes += addSize;
      }
      if (batch.length === 0) {
        isProcessing = false;
        return;
      }
      var body = batch.length > 1
        ? JSON.stringify({ events: batch.map(function (e) { return e.payload; }) })
        : JSON.stringify(batch[0].payload);
      var controller = new AbortController();
      var timeoutId = setTimeout(function () { controller.abort(); }, 5000);
      lastFlushAt = now;
      var syncUrl = new URL(CONFIG.apiUrl);
      syncUrl.searchParams.set('_ts', Date.now().toString());
      var response = await fetch(syncUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        signal: controller.signal,
        credentials: 'omit',
      });
      clearTimeout(timeoutId);
      var throttled = false;
      var debug = localStorage.getItem('opsmantik_debug') === '1';
      var batchNotSupported = false;
      if (batch.length > 1 && !response.ok) {
        var st = response.status;
        if (st === 400 || st === 415) batchNotSupported = true;
        else if (st >= 400 && st < 500) {
          try {
            var j = await response.clone().json();
            if (j && typeof j === 'object') {
              if (j.error === 'batch_not_supported' || j.code === 'BATCH_NOT_SUPPORTED') batchNotSupported = true;
            }
          } catch (_) { /* ignore */ }
        }
      }
      if (batchNotSupported) {
        batchSupported = false;
        batchRetryAt = now + BATCH_RETRY_AFTER_MS;
        isProcessing = false;
        if (debug) console.log('[OPSMANTIK_DEBUG] batch not supported', { batchRetryAt: batchRetryAt });
        processOutbox();
        return;
      }
      if (response.ok) {
        queue.splice(0, batch.length);
        saveQueue(queue);
        isProcessing = false;
        if (debug) {
          console.log('[OPSMANTIK_DEBUG] flush', { sentCount: batch.length, remainingQueueLength: queue.length, batchSupported: batchSupported, throttled: throttled });
        }
        processOutbox();
        return;
      }
      var status = response.status;
      var first = batch[0];
      if (status === 400) {
        try {
          var errBody = await response.clone().json();
          if (errBody && (errBody.code || errBody.error)) {
            console.warn('[OPSMANTIK] sync 400:', errBody.code || errBody.error, errBody.error || '');
          }
        } catch (_) { /* ignore */ }
      }
      // Quota exceeded (not rate limit): pause until Retry-After.
      if (status === 429) {
        try {
          var qx = response.headers && response.headers.get ? response.headers.get('x-opsmantik-quota-exceeded') : null;
          if (qx === '1') {
            var ra = response.headers.get('retry-after');
            var raSec = ra ? parseInt(ra, 10) : 0;
            // Fallback: if Retry-After missing, pause 10 minutes to stop storms.
            var pauseMs = (raSec && !isNaN(raSec) && raSec > 0) ? Math.min(raSec * 1000, 32 * 24 * 3600 * 1000) : 10 * 60 * 1000;
            quotaPausedUntil = now + pauseMs;
            first.nextAttemptAt = quotaPausedUntil;
            first.lastStatus = status;
            saveQueue(queue);
            if (localStorage.getItem('opsmantik_debug') === '1') {
              console.warn('[OPSMANTIK_DEBUG] quota pause', { retryAfterSec: raSec, pauseMs: pauseMs, until: quotaPausedUntil });
            }
            isProcessing = false;
            setTimeout(processOutbox, pauseMs);
            return;
          }
        } catch (_) { /* ignore */ }
      }
      var result = getRetryDelayMs(status, first.attempts);
      if (!result.retry) {
        first.dead = true;
        first.deadReason = '4xx';
        first.lastStatus = status;
        appendDeadLetter(first, status);
        if (debug) {
          console.warn('[OPSMANTIK_DEBUG] dead-letter', { status: status, ec: first.payload && first.payload.ec, ea: first.payload && first.payload.ea });
        }
        queue.splice(0, 1);
        saveQueue(queue);
        isProcessing = false;
        if (debug) {
          console.log('[OPSMANTIK_DEBUG] flush', { sentCount: 0, remainingQueueLength: queue.length, batchSupported: batchSupported, throttled: throttled });
        }
        processOutbox();
        return;
      }
      first.attempts++;
      first.nextAttemptAt = now + result.delayMs;
      first.lastStatus = status;
      saveQueue(queue);
      if (debug) {
        console.log('[OPSMANTIK_DEBUG] backoff', { status: status, attempts: first.attempts, delayMs: result.delayMs, nextAttemptAt: first.nextAttemptAt });
        console.log('[OPSMANTIK_DEBUG] flush', { sentCount: 0, remainingQueueLength: queue.length, batchSupported: batchSupported, throttled: throttled });
      }
      isProcessing = false;
      setTimeout(processOutbox, result.delayMs);
    } catch (err) {
      var firstCatch = batch && batch.length ? batch[0] : queue[0];
      var statusErr = parseStatusFromError(err);
      var resultErr = getRetryDelayMs(statusErr, firstCatch.attempts);
      if (!resultErr.retry) {
        firstCatch.dead = true;
        firstCatch.deadReason = '4xx';
        firstCatch.lastStatus = statusErr;
        appendDeadLetter(firstCatch, statusErr);
        if (localStorage.getItem('opsmantik_debug') === '1') {
          console.warn('[OPSMANTIK_DEBUG] dead-letter', { status: statusErr != null ? statusErr : 'parse-fail', ec: firstCatch.payload && firstCatch.payload.ec, ea: firstCatch.payload && firstCatch.payload.ea });
        }
        queue.splice(0, 1);
        saveQueue(queue);
        isProcessing = false;
        processOutbox();
        return;
      }
      console.warn('[TankTracker] Network Fail - Retrying later:', err.message);
      firstCatch.attempts++;
      firstCatch.nextAttemptAt = now + resultErr.delayMs;
      firstCatch.lastStatus = statusErr;
      saveQueue(queue);
      if (localStorage.getItem('opsmantik_debug') === '1') {
        console.log('[OPSMANTIK_DEBUG] backoff', { status: statusErr != null ? statusErr : 'network', attempts: firstCatch.attempts, delayMs: resultErr.delayMs, nextAttemptAt: firstCatch.nextAttemptAt });
        console.log('[OPSMANTIK_DEBUG] flush', { sentCount: 0, remainingQueueLength: queue.length, batchSupported: batchSupported, throttled: false });
      }
      isProcessing = false;
      setTimeout(processOutbox, resultErr.delayMs);
    }
  }

  function sendEvent(category, action, label, value, metadata) {
    if (metadata === undefined) metadata = {};
    const session = getOrCreateSession();
    const sessionId = session.sessionId;
    const fingerprint = session.fingerprint;
    const context = session.context;
    var url = (window.location && window.location.href) || (typeof document !== 'undefined' && document.URL) || '';
    if (!url || typeof url !== 'string') url = 'unknown';
    const referrer = document.referrer || '';
    const sessionMonth = new Date().toISOString().slice(0, 7) + '-01';
    const meta = {
      fp: fingerprint,
      gclid: context,
      wbraid: session.wbraid || undefined,
      gbraid: session.gbraid || undefined
    };
    if (session.urlParams && typeof session.urlParams === 'object') {
      Object.keys(session.urlParams).forEach(function (k) {
        if (session.urlParams[k] != null) meta[k] = session.urlParams[k];
      });
    }
    Object.assign(meta, getHardwareMeta());
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
    payload.consent_scopes = trackerConsentScopes;
    if (localStorage.getItem('opsmantik_debug') === '1') {
      console.log('[OPSMANTIK] Outbox:', category + '/' + action, sessionId.slice(0, 8) + '...');
    } else {
      console.log('[OPSMANTIK] Sending event:', { category, action, label, value, sessionId: sessionId.slice(0, 8) + '...' });
    }
    addToOutbox(payload);
  }

  // Call Event API — Phone/WhatsApp tıklamalarını calls tablosuna kaydet
  function sendCallEvent(phoneNumber) {
    const session = getOrCreateSession();
    const scriptCfgForCall = typeof window !== 'undefined' ? (window.opsmantikConfig || window.opmantikConfig) : null;
    const proxyUrl =
      (scriptTag && scriptTag.getAttribute && scriptTag.getAttribute('data-ops-proxy-url')) ||
      (scriptCfgForCall && scriptCfgForCall.opsProxyUrl) ||
      '';
    const callEventUrl = isLocalhost ? window.location.origin + '/api/call-event/v2' : 'https://console.opsmantik.com/api/call-event/v2';

    const eventId = generateUUID();
    const payload = {
      event_id: eventId,
      site_id: siteId,
      fingerprint: session.fingerprint,
      phone_number: phoneNumber,
      action: (typeof phoneNumber === 'string' && (phoneNumber.includes('wa.me') || phoneNumber.includes('whatsapp'))) ? 'whatsapp' : 'phone',
      url: window.location.href,
      ua: navigator.userAgent,
    };
    const rawBody = JSON.stringify(payload);

    // V2 preferred: first-party proxy (no secret in browser)
    if (proxyUrl) {
      fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
        keepalive: true,
        credentials: 'omit',
      }).catch(() => { /* silent */ });
      return;
    }

    // V1 fallback: Signed request (HMAC-SHA256): requires data-ops-secret on script tag
    const secret =
      (scriptTag && scriptTag.getAttribute && scriptTag.getAttribute('data-ops-secret')) ||
      (scriptCfgForCall && scriptCfgForCall.opsSecret) ||
      '';
    const debug = localStorage.getItem('opsmantik_debug') === '1';

    // If secret exists and crypto available, use signed flow (V1).
    if (secret && window.crypto && window.crypto.subtle) {
      const ts = Math.floor(Date.now() / 1000);
      const enc = new TextEncoder();
      const msg = ts + '.' + rawBody;

      window.crypto.subtle
        .importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
        .then((key) => window.crypto.subtle.sign('HMAC', key, enc.encode(msg)))
        .then((sigBuf) => {
          const bytes = new Uint8Array(sigBuf);
          let hex = '';
          for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');

          return fetch(callEventUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Ops-Site-Id': siteId,
              'X-Ops-Ts': String(ts),
              'X-Ops-Signature': hex,
            },
            body: rawBody,
            keepalive: true,
            credentials: 'omit',
          });
        })
        .catch(() => { /* silent */ });
      return;
    }

    // Unsigned fallback (GTM-like): no secret/proxy → send unsigned POST (requires CORS allowlist).
    if (debug) console.log('[OPSMANTIK] call-event unsigned mode');
    fetch(callEventUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => { /* silent */ });
  }

  // Auto-tracking
  function initAutoTracking() {
    console.log('[OPSMANTIK] Auto-tracking initialized');

    // Page view
    sendEvent('interaction', 'view', document.title);

    // Phone links (skip if inside JoinChat widget — handled by JoinChat listener)
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.joinchat, [class*="joinchat"]')) return;
      const target = e.target.closest('a[href^="tel:"]');
      if (target) {
        const intent_stamp = makeIntentStamp('tel', target.href);
        sendEvent('conversion', 'phone_call', target.href, null, {
          intent_stamp,
          intent_action: 'phone_call',
        });
        // Also record to calls table via /api/call-event
        sendCallEvent(target.href);
      }
    });

    // WhatsApp links: wa.me, whatsapp.com, chat.whatsapp.com (groups), joinchat, whatsapp://, and data-om-whatsapp (skip if inside JoinChat — handled by JoinChat listener)
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.joinchat, [class*="joinchat"]')) return;
      const dataWa = e.target.closest && e.target.closest('[data-om-whatsapp]');
      if (dataWa && dataWa.getAttribute('data-om-whatsapp')) {
        const href = dataWa.getAttribute('data-om-whatsapp');
        const intent_stamp = makeIntentStamp('wa', href);
        sendEvent('conversion', 'whatsapp', href, null, { intent_stamp, intent_action: 'whatsapp' });
        sendCallEvent(href);
        return;
      }
      const target = e.target.closest('a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="joinchat"], a[href^="whatsapp://"]');
      if (target) {
        const intent_stamp = makeIntentStamp('wa', target.href);
        sendEvent('conversion', 'whatsapp', target.href, null, {
          intent_stamp,
          intent_action: 'whatsapp',
        });
        sendCallEvent(target.href);
      }
    });

    // JoinChat widget: button is div (role=button), not <a>. Root has data-settings with telephone and whatsapp_web.
    document.addEventListener('click', (e) => {
      var widget = e.target.closest && e.target.closest('.joinchat, [class*="joinchat"]');
      if (!widget) return;
      var raw = widget.getAttribute && widget.getAttribute('data-settings');
      if (!raw) return;
      try {
        var settings = JSON.parse(raw);
        var tel = settings.telephone;
        if (!tel || typeof tel !== 'string') return;
        tel = String(tel).trim().replace(/\D/g, '');
        if (tel.length < 10) return;
        var isWa = settings.whatsapp_web === true;
        var href = isWa ? 'https://wa.me/' + tel : 'tel:' + tel;
        var action = isWa ? 'whatsapp' : 'phone_call';
        var intent_stamp = makeIntentStamp(isWa ? 'wa' : 'tel', href);
        sendEvent('conversion', action, href, null, { intent_stamp: intent_stamp, intent_action: action });
        sendCallEvent(href);
      } catch (err) { /* ignore */ }
    }, true);

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
        // Send scroll thresholds only once per session (prevents spam/quota burn)
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

    // CTA hover count (Intent Pulse)
    document.addEventListener('mouseenter', (e) => {
      const t = e.target.closest && e.target.closest('a[href^="tel:"], a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="joinchat"], a[href^="whatsapp://"], [data-om-whatsapp], [data-om-cta="true"]');
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

    // Active seconds (Intent Pulse) + P0-2: one immediate heartbeat on visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        pulse.activeSec += Math.round((Date.now() - pulse.lastActiveAt) / 1000);
      } else {
        pulse.lastActiveAt = Date.now();
        if (localStorage.getItem('opsmantik_debug') === '1') {
          console.log('[OPSMANTIK_DEBUG] heartbeat resumed (one immediate)');
        }
        sendEvent('system', 'heartbeat', 'session_active');
      }
    });

    // Heartbeat: only when tab visible (P0-2); single setInterval
    setInterval(function () {
      if (document.hidden) {
        if (localStorage.getItem('opsmantik_debug') === '1') {
          console.log('[OPSMANTIK_DEBUG] heartbeat skipped due to hidden');
        }
        return;
      }
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

  // Public API (correct spelling: opsmantik; legacy opmantik for backward compatibility)
  window.opsmantik = {
    send: sendEvent,
    session: getOrCreateSession,
    setConsent: function (scopes) { updateTrackerConsent(Array.isArray(scopes) ? scopes : []); },
    _initialized: true,
  };
  window.opmantik = window.opsmantik;

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
