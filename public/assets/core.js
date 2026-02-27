/* eslint-disable */
// AUTO-GENERATED from lib/tracker — do not edit manually.
// Run: npm run tracker:build

"use strict";
(() => {
  // lib/tracker/config.js
  var scriptTag = typeof document !== "undefined" ? document.currentScript || document.querySelector("script[data-ops-site-id], script[data-site-id]") : null;
  var dataApi = scriptTag ? scriptTag.getAttribute("data-api") : null;
  var CONFIG = {
    apiUrl: dataApi || (typeof window !== "undefined" ? window.location.origin + "/api/sync" : ""),
    sessionKey: "opsmantik_session_sid",
    fingerprintKey: "opsmantik_session_fp",
    contextKey: "opsmantik_session_context",
    contextWbraidKey: "opsmantik_session_wbraid",
    contextGbraidKey: "opsmantik_session_gbraid",
    sessionStartKey: "opsmantik_session_start",
    heartbeatInterval: 6e4,
    sessionTimeout: 18e5
  };
  function getSiteId() {
    const scriptTag2 = document.currentScript || document.querySelector("script[data-ops-site-id], script[data-site-id]");
    let siteId2 = scriptTag2 ? scriptTag2.getAttribute("data-ops-site-id") || scriptTag2.getAttribute("data-site-id") || "" : "";
    if (!siteId2 && typeof window !== "undefined") {
      const cfg = window.opsmantikConfig || window.opmantikConfig;
      if (cfg && typeof cfg.siteId === "string") siteId2 = String(cfg.siteId);
    }
    if (!siteId2) {
      const allScripts = document.getElementsByTagName("script");
      for (let i = 0; i < allScripts.length; i++) {
        const s = allScripts[i];
        const src = (s.src || "").toLowerCase();
        if ((src.indexOf("core.js") !== -1 || src.indexOf("ux-core.js") !== -1) && (s.getAttribute("data-ops-site-id") || s.getAttribute("data-site-id"))) {
          siteId2 = s.getAttribute("data-ops-site-id") || s.getAttribute("data-site-id") || "";
          break;
        }
      }
    }
    return siteId2;
  }

  // lib/tracker/utils.js
  function generateFingerprint() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillText("Fingerprint", 2, 2);
    const fingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width + "x" + screen.height,
      (/* @__PURE__ */ new Date()).getTimezoneOffset(),
      canvas.toDataURL()
    ].join("|");
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
  function generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  }
  function rand4() {
    return Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  }
  function hash6(str) {
    const s = (str || "").toString();
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    const out = Math.abs(h).toString(36);
    return out.slice(0, 6).padEnd(6, "0");
  }
  function makeIntentStamp(actionShort, target) {
    const ts = Date.now();
    const tHash = hash6((target || "").toString().toLowerCase());
    return `${ts}-${rand4()}-${actionShort}-${tHash}`;
  }
  function getHardwareMeta() {
    const o = {};
    try {
      if (navigator.language) o.lan = navigator.language;
    } catch {
    }
    try {
      if (typeof navigator.deviceMemory === "number") o.mem = navigator.deviceMemory;
    } catch {
    }
    try {
      if (typeof navigator.hardwareConcurrency === "number") o.con = navigator.hardwareConcurrency;
    } catch {
    }
    try {
      if (typeof screen !== "undefined") {
        o.sw = screen.width;
        o.sh = screen.height;
      }
    } catch {
    }
    try {
      if (typeof window.devicePixelRatio === "number") o.dpr = window.devicePixelRatio;
    } catch {
    }
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (gl) {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          const r = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          if (r) o.gpu = r;
        }
      }
    } catch {
    }
    try {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn && conn.effectiveType) o.con_type = conn.effectiveType;
    } catch {
    }
    return o;
  }
  function getAdsContext() {
    const STORAGE_KEY = "opsmantik_ads_ctx";
    try {
      const p = new URLSearchParams(window.location.search);
      const keyword = p.get("ops_kw") || void 0;
      const match_type = p.get("ops_mt") || void 0;
      const network = p.get("ops_net") || void 0;
      const device = p.get("ops_dv") || void 0;
      const device_model = p.get("ops_mdl") || void 0;
      const geoRaw = p.get("ops_geo");
      const geo_target_id = geoRaw ? parseInt(geoRaw, 10) || void 0 : void 0;
      const campaign_id = p.get("ops_cmp") ? parseInt(p.get("ops_cmp"), 10) || void 0 : void 0;
      const adgroup_id = p.get("ops_adg") ? parseInt(p.get("ops_adg"), 10) || void 0 : void 0;
      const creative_id = p.get("ops_crt") ? parseInt(p.get("ops_crt"), 10) || void 0 : void 0;
      const placement = p.get("ops_plc") || void 0;
      const target_id = p.get("ops_tgt") ? parseInt(p.get("ops_tgt"), 10) || void 0 : void 0;
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
      if (Object.keys(fromUrl).length > 0) {
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fromUrl));
        } catch {
        }
        return fromUrl;
      }
      try {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) return parsed;
        }
      } catch {
      }
    } catch {
    }
    return null;
  }

  // lib/tracker/session.js
  function getUrlParams() {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (typeof window !== "undefined" && window.location.hash) {
      const raw = window.location.hash.replace(/^#\??/, "");
      const afterQ = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
      if (afterQ.includes("=")) {
        try {
          const hashParams = new URLSearchParams(afterQ);
          hashParams.forEach((value, key) => {
            params.set(key, value);
          });
        } catch {
        }
      }
    }
    return params;
  }
  function getTemplateParams(params) {
    const p = (key) => params.get(key) || void 0;
    return {
      utm_source: p("utm_source"),
      utm_medium: p("utm_medium"),
      utm_campaign: p("utm_campaign"),
      utm_adgroup: p("utm_adgroup"),
      utm_content: p("utm_content"),
      utm_term: p("utm_term"),
      device: p("device"),
      devicemodel: p("devicemodel"),
      targetid: p("targetid"),
      network: p("network"),
      adposition: p("adposition"),
      feeditemid: p("feeditemid"),
      loc_interest_ms: p("loc_interest_ms"),
      loc_physical_ms: p("loc_physical_ms"),
      matchtype: p("matchtype")
    };
  }
  function getOrCreateSession() {
    let sessionId = sessionStorage.getItem(CONFIG.sessionKey);
    let fingerprint = localStorage.getItem(CONFIG.fingerprintKey);
    let context = sessionStorage.getItem(CONFIG.contextKey);
    if (!fingerprint) {
      fingerprint = generateFingerprint();
      localStorage.setItem(CONFIG.fingerprintKey, fingerprint);
    }
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
    const gclid = urlParams.get("gclid") || context;
    const wbraid = urlParams.get("wbraid") || localStorage.getItem(CONFIG.contextWbraidKey) || sessionStorage.getItem(CONFIG.contextWbraidKey);
    const gbraid = urlParams.get("gbraid") || localStorage.getItem(CONFIG.contextGbraidKey) || sessionStorage.getItem(CONFIG.contextGbraidKey);
    if (gclid) {
      sessionStorage.setItem(CONFIG.contextKey, gclid);
      localStorage.setItem(CONFIG.contextKey, gclid);
      context = gclid;
    }
    if (wbraid) {
      sessionStorage.setItem(CONFIG.contextWbraidKey, wbraid);
      localStorage.setItem(CONFIG.contextWbraidKey, wbraid);
    }
    if (gbraid) {
      sessionStorage.setItem(CONFIG.contextGbraidKey, gbraid);
      localStorage.setItem(CONFIG.contextGbraidKey, gbraid);
    }
    const urlParamsObj = getTemplateParams(urlParams);
    return {
      sessionId,
      fingerprint,
      context,
      wbraid: wbraid || null,
      gbraid: gbraid || null,
      urlParams: urlParamsObj
    };
  }

  // lib/tracker/transport.js
  var QUEUE_KEY = "opsmantik_outbox_v2";
  var DEAD_LETTER_KEY = "opsmantik_dead_letters";
  var MAX_DEAD_LETTERS = 20;
  var JITTER_MS = 3e3;
  var MAX_BATCH = 20;
  var MIN_FLUSH_INTERVAL_MS = 2e3;
  var PAYLOAD_CAP_BYTES = 50 * 1024;
  var BATCH_RETRY_AFTER_MS = 5 * 60 * 1e3;
  var isProcessing = false;
  var batchSupported = true;
  var batchRetryAt = 0;
  var lastFlushAt = 0;
  var quotaPausedUntil = 0;
  function appendDeadLetter(envelope, status) {
    const storage = getStorage();
    if (!storage) return;
    try {
      const payload = envelope.payload || {};
      const ec = payload.ec;
      const ea = payload.ea;
      const attempts = envelope.attempts ?? 0;
      let list = [];
      try {
        list = JSON.parse(storage.getItem(DEAD_LETTER_KEY) || "[]");
      } catch {
        list = [];
      }
      list.push({ ts: Date.now(), status, ec, ea, attempts });
      if (list.length > MAX_DEAD_LETTERS) list = list.slice(-MAX_DEAD_LETTERS);
      storage.setItem(DEAD_LETTER_KEY, JSON.stringify(list));
    } catch {
    }
  }
  function getRetryDelayMs(status, attempts) {
    if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) {
      return { delayMs: 0, retry: false };
    }
    const jitter = Math.floor(Math.random() * (JITTER_MS + 1));
    if (status === 429) {
      const base2 = Math.min(6e5, Math.max(3e4, 3e4 * Math.pow(2, attempts)));
      return { delayMs: base2 + jitter, retry: true };
    }
    const base = Math.min(12e4, Math.max(5e3, 5e3 * Math.pow(2, attempts)));
    return { delayMs: base + jitter, retry: true };
  }
  function getStorage() {
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem) return localStorage;
    } catch {
    }
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem) return sessionStorage;
    } catch {
    }
    return null;
  }
  function getQueue() {
    const storage = getStorage();
    if (!storage) return [];
    try {
      return JSON.parse(storage.getItem(QUEUE_KEY) || "[]");
    } catch {
      return [];
    }
  }
  function saveQueue(queue) {
    const storage = getStorage();
    if (!storage) return;
    try {
      storage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch {
      try {
        if (storage !== sessionStorage && typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        }
      } catch {
      }
    }
  }
  function parseStatusFromError(err) {
    if (err && typeof err.message === "string") {
      const m = err.message.match(/Server status: (\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    return void 0;
  }
  async function processOutbox() {
    if (isProcessing) return;
    const queue = getQueue();
    if (queue.length === 0) return;
    const now = Date.now();
    if (quotaPausedUntil > now) {
      setTimeout(processOutbox, quotaPausedUntil - now);
      return;
    }
    const currentEnvelope = queue[0];
    const nextAt = currentEnvelope.nextAttemptAt;
    if (nextAt != null && nextAt > 0 && nextAt > now) {
      const waitMs = nextAt - now;
      setTimeout(processOutbox, waitMs);
      return;
    }
    isProcessing = true;
    let batch = [];
    try {
      while (queue.length && queue[0].attempts > 10 && now - (queue[0].ts || now) > 864e5) {
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
      if (lastFlushAt > 0 && now - lastFlushAt < MIN_FLUSH_INTERVAL_MS) {
        const delayMs2 = lastFlushAt + MIN_FLUSH_INTERVAL_MS - now;
        isProcessing = false;
        if (typeof localStorage !== "undefined" && localStorage.getItem("opsmantik_debug") === "1") {
          console.log("[OPSMANTIK_DEBUG] throttle scheduled", { delayMs: delayMs2, lastFlushAt, now });
        }
        setTimeout(() => processOutbox(), delayMs2);
        return;
      }
      if (batchRetryAt > 0 && now >= batchRetryAt) {
        batchSupported = true;
        batchRetryAt = 0;
      }
      const maxBatch = batchSupported ? MAX_BATCH : 1;
      const batch2 = [];
      let payloadBytes = 0;
      for (let i = 0; i < queue.length && batch2.length < maxBatch; i++) {
        const env = queue[i];
        if (env.nextAttemptAt != null && env.nextAttemptAt > 0 && env.nextAttemptAt > now) break;
        if (env.attempts > 10 && now - (env.ts || now) > 864e5) continue;
        const envSize = JSON.stringify(env.payload).length;
        const addSize = batch2.length === 0 ? envSize : envSize + 2;
        if (payloadBytes + addSize > PAYLOAD_CAP_BYTES) break;
        batch2.push(env);
        payloadBytes += addSize;
      }
      if (batch2.length === 0) {
        isProcessing = false;
        return;
      }
      const body = batch2.length > 1 ? JSON.stringify({ events: batch2.map((e) => e.payload) }) : JSON.stringify(batch2[0].payload);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5e3);
      lastFlushAt = now;
      const syncUrl = new URL(CONFIG.apiUrl);
      syncUrl.searchParams.set("_ts", Date.now().toString());
      const response = await fetch(syncUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        signal: controller.signal,
        credentials: "omit"
      });
      clearTimeout(timeoutId);
      const throttled = false;
      const debug = typeof localStorage !== "undefined" && localStorage.getItem("opsmantik_debug") === "1";
      let batchNotSupported = false;
      if (batch2.length > 1 && !response.ok) {
        const st = response.status;
        if (st === 400 || st === 415) batchNotSupported = true;
        else if (st >= 400 && st < 500) {
          try {
            const j = await response.clone().json();
            if (j && typeof j === "object") {
              if (j.error === "batch_not_supported" || j.code === "BATCH_NOT_SUPPORTED") batchNotSupported = true;
            }
          } catch {
          }
        }
      }
      if (batchNotSupported) {
        batchSupported = false;
        batchRetryAt = now + BATCH_RETRY_AFTER_MS;
        isProcessing = false;
        if (debug) console.log("[OPSMANTIK_DEBUG] batch not supported", { batchRetryAt });
        processOutbox();
        return;
      }
      if (response.ok) {
        queue.splice(0, batch2.length);
        saveQueue(queue);
        isProcessing = false;
        if (debug) {
          console.log("[OPSMANTIK_DEBUG] flush", { sentCount: batch2.length, remainingQueueLength: queue.length, batchSupported, throttled });
        }
        processOutbox();
        return;
      }
      const status = response.status;
      const first = batch2[0];
      if (status === 429) {
        const qx = response.headers.get("x-opsmantik-quota-exceeded");
        if (qx === "1") {
          const ra = response.headers.get("retry-after");
          const raSec = parseInt(ra || "600", 10) || 600;
          quotaPausedUntil = now + raSec * 1e3;
          first.nextAttemptAt = quotaPausedUntil;
          first.lastStatus = status;
          saveQueue(queue);
          isProcessing = false;
          setTimeout(processOutbox, raSec * 1e3);
          return;
        }
      }
      const { delayMs, retry } = getRetryDelayMs(status, first.attempts);
      if (!retry) {
        first.dead = true;
        first.deadReason = "4xx";
        first.lastStatus = status;
        appendDeadLetter(first, status);
        if (debug) {
          console.warn("[OPSMANTIK_DEBUG] dead-letter", { status, ec: first.payload?.ec, ea: first.payload?.ea });
        }
        queue.splice(0, 1);
        saveQueue(queue);
        isProcessing = false;
        if (debug) {
          console.log("[OPSMANTIK_DEBUG] flush", { sentCount: 0, remainingQueueLength: queue.length, batchSupported, throttled });
        }
        processOutbox();
        return;
      }
      first.attempts++;
      first.nextAttemptAt = now + delayMs;
      first.lastStatus = status;
      saveQueue(queue);
      if (debug) {
        console.log("[OPSMANTIK_DEBUG] backoff", { status, attempts: first.attempts, delayMs, nextAttemptAt: first.nextAttemptAt });
      }
      isProcessing = false;
      if (debug) {
        console.log("[OPSMANTIK_DEBUG] flush", { sentCount: 0, remainingQueueLength: queue.length, batchSupported, throttled });
      }
      setTimeout(processOutbox, delayMs);
    } catch (err) {
      const first = batch && batch.length ? batch[0] : queue[0];
      const status = parseStatusFromError(err);
      const { delayMs, retry } = getRetryDelayMs(status, first.attempts);
      if (!retry) {
        first.dead = true;
        first.deadReason = "4xx";
        first.lastStatus = status;
        appendDeadLetter(first, status);
        if (typeof localStorage !== "undefined" && localStorage.getItem("opsmantik_debug") === "1") {
          console.warn("[OPSMANTIK_DEBUG] dead-letter", { status: status != null ? status : "parse-fail", ec: first.payload?.ec, ea: first.payload?.ea });
        }
        queue.splice(0, 1);
        saveQueue(queue);
        isProcessing = false;
        processOutbox();
        return;
      }
      console.warn("[TankTracker] Network Fail - Retrying later:", err.message);
      first.attempts++;
      first.nextAttemptAt = now + delayMs;
      first.lastStatus = status;
      saveQueue(queue);
      if (typeof localStorage !== "undefined" && localStorage.getItem("opsmantik_debug") === "1") {
        console.log("[OPSMANTIK_DEBUG] backoff", { status: status != null ? status : "network", attempts: first.attempts, delayMs, nextAttemptAt: first.nextAttemptAt });
        console.log("[OPSMANTIK_DEBUG] flush", { sentCount: 0, remainingQueueLength: queue.length, batchSupported, throttled: false });
      }
      isProcessing = false;
      setTimeout(processOutbox, delayMs);
    }
  }
  function addToOutbox(payload) {
    const queue = getQueue();
    const envelopeId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : generateUUID();
    const envelope = {
      id: envelopeId,
      ts: Date.now(),
      payload,
      attempts: 0,
      nextAttemptAt: 0,
      lastStatus: void 0
    };
    queue.push(envelope);
    if (queue.length > 100) {
      queue.splice(0, queue.length - 80);
    }
    saveQueue(queue);
    processOutbox();
  }
  function lastGaspFlush() {
    const queue = getQueue();
    if (queue.length > 0 && navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.apiUrl, new Blob([JSON.stringify(queue[0].payload)], { type: "application/json" }));
    }
  }

  // lib/tracker/pulse.js
  var pulse = {
    maxScroll: 0,
    sentScroll50: false,
    sentScroll90: false,
    ctaHovers: 0,
    focusDur: 0,
    activeSec: 0,
    lastActiveAt: typeof Date !== "undefined" ? Date.now() : 0
  };
  function getPulseMeta() {
    const o = {};
    if (pulse.maxScroll > 0) o.scroll_pct = Math.min(100, pulse.maxScroll);
    if (pulse.ctaHovers > 0) o.cta_hovers = pulse.ctaHovers;
    if (pulse.focusDur > 0) o.focus_dur = pulse.focusDur;
    if (pulse.activeSec > 0) o.active_sec = pulse.activeSec;
    let startTs = 0;
    try {
      startTs = parseInt(sessionStorage.getItem(CONFIG.sessionStartKey) || "0", 10);
    } catch {
    }
    if (startTs > 0) {
      o.duration_sec = Math.round((Date.now() - startTs) / 1e3);
    }
    return o;
  }

  // lib/tracker/tracker.js
  var siteId = getSiteId();
  if (!siteId) {
    console.warn("[OPSMANTIK] \u274C Site ID not found");
  } else {
    console.log("[OPSMANTIK] \u2705 Tracker initializing for site:", siteId);
  }
  var trackerConsentScopes = ["analytics", "marketing"];
  function sendEvent(category, action, label, value, metadata = {}) {
    if (!siteId) return;
    const session = getOrCreateSession();
    const url = window.location.href;
    const referrer = document.referrer || "";
    const sessionMonth = (/* @__PURE__ */ new Date()).toISOString().slice(0, 7) + "-01";
    const meta = {
      fp: session.fingerprint,
      gclid: session.context,
      wbraid: session.wbraid || void 0,
      gbraid: session.gbraid || void 0
    };
    if (session.urlParams && typeof session.urlParams === "object") {
      Object.keys(session.urlParams).forEach((k) => {
        if (session.urlParams[k] != null) meta[k] = session.urlParams[k];
      });
    }
    const hw = getHardwareMeta();
    Object.assign(meta, hw);
    const scriptTag2 = document.currentScript || document.querySelector("script[data-ops-site-id]");
    if (scriptTag2) {
      const dc = scriptTag2.getAttribute("data-geo-city");
      const dd = scriptTag2.getAttribute("data-geo-district");
      if (dc) meta.city = dc;
      if (dd) meta.district = dd;
    }
    if (category === "conversion" || action === "heartbeat" || action === "session_end") {
      if (action === "heartbeat") {
        pulse.activeSec += Math.round((Date.now() - pulse.lastActiveAt) / 1e3);
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
      meta,
      consent_scopes: trackerConsentScopes
    };
    if (typeof localStorage !== "undefined" && localStorage.getItem("opsmantik_debug") === "1") {
      console.log("[OPSMANTIK] Outbox:", category + "/" + action, session.sessionId.slice(0, 8) + "...");
    }
    addToOutbox(payload);
  }
  function sendCallEvent(phoneNumber) {
    if (!siteId) return;
    const session = getOrCreateSession();
    const base = CONFIG.apiUrl ? CONFIG.apiUrl.replace(/\/api\/sync\/?$/, "") : window.location.origin;
    const callEventUrl = base + "/api/call-event/v2";
    const scriptTag2 = document.currentScript || document.querySelector("script[data-ops-site-id]");
    const proxyUrl = scriptTag2?.getAttribute("data-ops-proxy-url") || (window.opsmantikConfig || window.opmantikConfig || {})?.opsProxyUrl || "";
    const eventId = generateUUID();
    const adsCtx = getAdsContext();
    const payloadObj = {
      event_id: eventId,
      site_id: siteId,
      phone_number: phoneNumber,
      fingerprint: session.fingerprint,
      action: typeof phoneNumber === "string" && (phoneNumber.indexOf("wa.me") !== -1 || phoneNumber.indexOf("whatsapp") !== -1) ? "whatsapp" : "phone",
      url: window.location.href,
      ua: navigator.userAgent,
      gclid: session.context,
      wbraid: session.wbraid,
      gbraid: session.gbraid
    };
    if (adsCtx) payloadObj.ads_context = adsCtx;
    const payload = JSON.stringify(payloadObj);
    if (proxyUrl) {
      fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {
      });
      return;
    }
    const secret = scriptTag2?.getAttribute("data-ops-secret") || (window.opsmantikConfig || window.opmantikConfig || {})?.opsSecret || "";
    if (secret && window.crypto?.subtle) {
      const ts = Math.floor(Date.now() / 1e3);
      const enc = new TextEncoder();
      const msg = ts + "." + payload;
      window.crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then((key) => window.crypto.subtle.sign("HMAC", key, enc.encode(msg))).then((sigBuf) => {
        const hex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
        return fetch(callEventUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ops-Site-Id": siteId,
            "X-Ops-Ts": String(ts),
            "X-Ops-Signature": hex
          },
          body: payload,
          keepalive: true
        });
      }).catch(() => {
      });
      return;
    }
    fetch(callEventUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {
    });
  }
  function initAutoTracking() {
    console.log("[OPSMANTIK] Auto-tracking initialized");
    sendEvent("interaction", "view", document.title);
    document.addEventListener("click", (e) => {
      const tel = e.target.closest('a[href^="tel:"]');
      if (tel) {
        const stamp = makeIntentStamp("tel", tel.href);
        sendEvent("conversion", "phone_call", tel.href, null, { intent_stamp: stamp, intent_action: "phone_call" });
        sendCallEvent(tel.href);
        return;
      }
      const dataWa = e.target.closest && e.target.closest("[data-om-whatsapp]");
      if (dataWa && dataWa.getAttribute("data-om-whatsapp")) {
        const href = dataWa.getAttribute("data-om-whatsapp");
        const stamp = makeIntentStamp("wa", href);
        sendEvent("conversion", "whatsapp", href, null, { intent_stamp: stamp, intent_action: "whatsapp" });
        sendCallEvent(href);
      } else {
        const wa = e.target.closest('a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="joinchat"], a[href^="whatsapp://"]');
        if (wa) {
          const stamp = makeIntentStamp("wa", wa.href);
          sendEvent("conversion", "whatsapp", wa.href, null, { intent_stamp: stamp, intent_action: "whatsapp" });
          sendCallEvent(wa.href);
        }
      }
    });
    document.addEventListener("submit", (e) => {
      if (e.target.tagName === "FORM") {
        sendEvent("conversion", "form_submit", e.target.id || e.target.name || "form");
      }
    });
    window.addEventListener("scroll", () => {
      const doc = document.documentElement;
      const scrollPercent = Math.round((window.scrollY + window.innerHeight) / doc.scrollHeight * 100);
      if (scrollPercent > pulse.maxScroll) {
        pulse.maxScroll = scrollPercent;
        if (!pulse.sentScroll50 && scrollPercent >= 50) {
          pulse.sentScroll50 = true;
          sendEvent("interaction", "scroll_depth", "50%", scrollPercent);
        }
        if (!pulse.sentScroll90 && scrollPercent >= 90) {
          pulse.sentScroll90 = true;
          sendEvent("interaction", "scroll_depth", "90%", scrollPercent);
        }
      }
    });
    document.addEventListener("mouseenter", (e) => {
      const cta = e.target.closest && e.target.closest('a[href^="tel:"], a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="joinchat"], a[href^="whatsapp://"], [data-om-whatsapp], [data-om-cta="true"]');
      if (cta) pulse.ctaHovers++;
    }, true);
    let focusStart = 0;
    document.addEventListener("focusin", (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) focusStart = Date.now();
    });
    document.addEventListener("focusout", (e) => {
      if (focusStart > 0 && e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
        pulse.focusDur += Math.round((Date.now() - focusStart) / 1e3);
        focusStart = 0;
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        pulse.activeSec += Math.round((Date.now() - pulse.lastActiveAt) / 1e3);
      } else {
        pulse.lastActiveAt = Date.now();
        if (typeof localStorage !== "undefined" && localStorage.getItem("opsmantik_debug") === "1") {
          console.log("[OPSMANTIK_DEBUG] heartbeat resumed (one immediate)");
        }
        sendEvent("system", "heartbeat", "session_active");
      }
    });
    setInterval(() => {
      if (document.hidden) {
        if (typeof localStorage !== "undefined" && localStorage.getItem("opsmantik_debug") === "1") {
          console.log("[OPSMANTIK_DEBUG] heartbeat skipped due to hidden");
        }
        return;
      }
      sendEvent("system", "heartbeat", "session_active");
    }, CONFIG.heartbeatInterval);
    window.addEventListener("beforeunload", () => {
      pulse.activeSec += Math.round((Date.now() - pulse.lastActiveAt) / 1e3);
      sendEvent("system", "session_end", "page_unload", null, { exit_page: window.location.href });
      lastGaspFlush();
    });
  }
  function initTracker() {
    if (window.__opsmantikTrackerInitialized) {
      if (typeof localStorage !== "undefined" && localStorage.getItem("opsmantik_debug") === "1") {
        console.warn("[OPSMANTIK_DEBUG] tracker init skipped (duplicate)", { ts: Date.now() });
      }
      return;
    }
    window.__opsmantikTrackerInitialized = true;
    window.opsmantik = {
      send: sendEvent,
      session: getOrCreateSession,
      _initialized: true
    };
    window.opmantik = window.opsmantik;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        processOutbox();
        initAutoTracking();
      });
    } else {
      processOutbox();
      initAutoTracking();
    }
    window.addEventListener("online", processOutbox);
  }
  if (typeof window !== "undefined") initTracker();
})();
