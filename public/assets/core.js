/* eslint-disable */
// AUTO-GENERATED from lib/tracker — do not edit manually.
// Run: npm run tracker:build

"use strict";
(() => {
  // lib/tracker/config.js
  var scriptTag = typeof document !== "undefined" ? document.currentScript || document.querySelector("script[data-ops-site-id], script[data-site-id]") : null;
  var proxyUrl = scriptTag ? scriptTag.getAttribute("data-ops-proxy-url") : null;
  var syncProxyUrl = scriptTag ? scriptTag.getAttribute("data-ops-sync-proxy-url") : null;
  var dataApi = scriptTag ? scriptTag.getAttribute("data-api") : null;
  var runtimeConfig = typeof window !== "undefined" ? window.opsmantikConfig || window.opmantikConfig || {} : {};
  function deriveSyncProxyUrl(url) {
    if (!url || typeof url !== "string") return "";
    return url.replace(/\/call-event\/?$/i, "/sync");
  }
  var resolvedApiUrl = syncProxyUrl || runtimeConfig.opsSyncProxyUrl || dataApi || deriveSyncProxyUrl(proxyUrl || runtimeConfig.opsProxyUrl || "") || (typeof window !== "undefined" ? window.location.origin + "/api/sync" : "");
  if (typeof window !== "undefined" && resolvedApiUrl) {
    try {
      const apiHost = new URL(resolvedApiUrl).hostname;
      const pageHost = window.location.hostname;
      if (apiHost === pageHost) {
        console.warn(
          "[OPSMANTIK] Sync URL is same-origin (" + resolvedApiUrl + '). Events will not reach OpsMantik. Set data-api (or data-ops-sync-proxy-url) on the script tag to your OpsMantik backend, e.g. data-api="https://YOUR_APP.vercel.app/api/sync"'
        );
      }
    } catch (_) {
    }
  }
  var CONFIG = {
    apiUrl: resolvedApiUrl,
    trackerVersion: runtimeConfig.opsTrackerVersion || "core-shadow-2026-11-05",
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
  function normalizeDialTarget(raw) {
    const normalized = (raw || "").toString().replace(/[^\d+]/g, "");
    return normalized.length > 0 ? normalized : null;
  }
  function canonicalizeWhatsAppTarget(raw) {
    const t = (raw || "").toString().trim();
    const lower = t.toLowerCase();
    if (!lower.startsWith("whatsapp:") && !lower.startsWith("whatsapp://") && !lower.includes("wa.me") && !lower.includes("whatsapp.com") && !lower.includes("chat.whatsapp.com") && !lower.includes("joinchat")) {
      return null;
    }
    const phoneFromQuery = (t.match(/[?&]phone=([^&#]+)/i) || [])[1] || null;
    const phoneFromWaMe = (t.match(/wa\.me\/([^/?#]+)/i) || [])[1] || null;
    const phoneFromScheme = (t.match(/^whatsapp:\s*(.+)$/i) || [])[1] || null;
    const rawPhoneCandidate = phoneFromQuery || phoneFromWaMe || phoneFromScheme || "";
    let decodedPhoneCandidate = rawPhoneCandidate;
    try {
      decodedPhoneCandidate = decodeURIComponent(rawPhoneCandidate);
    } catch {
      decodedPhoneCandidate = rawPhoneCandidate;
    }
    const normalizedPhone = normalizeDialTarget(decodedPhoneCandidate);
    if (normalizedPhone) {
      return `whatsapp:${normalizedPhone}`;
    }
    const hostMatch = t.match(/^https?:\/\/([^/?#]+)/i);
    const host = ((hostMatch || [])[1] || "").toLowerCase();
    const pathMatch = t.match(/^https?:\/\/[^/?#]+\/([^?#]+)/i);
    const path = ((pathMatch || [])[1] || "").replace(/^\/+/, "");
    if (host === "chat.whatsapp.com") {
      const inviteCode = path.split("/")[0] || "unknown";
      return `whatsapp:joinchat/${inviteCode}`;
    }
    if ((host === "api.whatsapp.com" || host === "web.whatsapp.com") && path.toLowerCase().startsWith("joinchat")) {
      const inviteCode = path.replace(/^joinchat\/?/i, "") || "unknown";
      return `whatsapp:joinchat/${inviteCode}`;
    }
    const canonicalUrl = t.replace(/^https?:\/\//i, "").replace(/\?.*$/, "").replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
    return canonicalUrl ? `whatsapp:${canonicalUrl}` : "whatsapp:unknown";
  }
  function normalizePhoneTarget(raw) {
    const t = (raw || "").toString().trim();
    const whatsappTarget = canonicalizeWhatsAppTarget(t);
    if (whatsappTarget) return whatsappTarget;
    if (t.toLowerCase().startsWith("tel:")) {
      return normalizeDialTarget(t.slice(4)) || "";
    }
    if (/^\+?\d[\d\s().-]{6,}$/.test(t)) {
      return normalizeDialTarget(t) || "";
    }
    return t;
  }
  function inferIntentAction(raw) {
    const normalizedTarget = normalizePhoneTarget(raw).toLowerCase();
    const t = (raw || "").toString().toLowerCase();
    if (normalizedTarget.startsWith("whatsapp:")) return "whatsapp";
    if (t.includes("wa.me") || t.includes("whatsapp.com") || t.includes("chat.whatsapp.com") || t.includes("joinchat") || t.startsWith("whatsapp://")) return "whatsapp";
    if (t.startsWith("tel:")) return "phone";
    return "phone";
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
  function getUnloadPriority(envelope) {
    const payload = envelope?.payload || {};
    const category = payload.ec;
    const action = payload.ea;
    if (category === "conversion" && (action === "phone_call" || action === "whatsapp_click")) return 0;
    if (category === "conversion") return 1;
    if (action === "session_end") return 2;
    return 3;
  }
  function buildUnloadBeaconBody(queue) {
    const prioritized = [...queue].sort((a, b) => {
      const pa = getUnloadPriority(a);
      const pb = getUnloadPriority(b);
      if (pa !== pb) return pa - pb;
      return (a?.ts || 0) - (b?.ts || 0);
    });
    const selected = [];
    let totalBytes = 0;
    for (const envelope of prioritized) {
      const payload = envelope?.payload;
      if (!payload) continue;
      const serialized = JSON.stringify(payload);
      const size = serialized.length;
      if (selected.length > 0 && totalBytes + size > PAYLOAD_CAP_BYTES) break;
      selected.push(payload);
      totalBytes += size;
      if (selected.length >= MAX_BATCH) break;
    }
    if (selected.length === 0) return null;
    return selected.length === 1 ? selected[0] : { events: selected };
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
      const SYNC_TIMEOUT_MS = 15e3;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new DOMException(`Sync timeout after ${SYNC_TIMEOUT_MS / 1e3}s`, "AbortError")), SYNC_TIMEOUT_MS);
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
      const body = buildUnloadBeaconBody(queue);
      if (!body) return;
      navigator.sendBeacon(CONFIG.apiUrl, new Blob([JSON.stringify(body)], { type: "application/json" }));
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
  function getTrackerScriptTag() {
    return document.currentScript || document.querySelector("script[data-ops-site-id]") || document.querySelector("script[data-site-id]");
  }
  var recentTrackedIntentAt = /* @__PURE__ */ new Map();
  var lastPointerContext = null;
  var FORM_PENDING_STORAGE_KEY = "opsmantik_form_pending_v1";
  var formLifecycleState = /* @__PURE__ */ new WeakMap();
  var pendingFormAttempts = [];
  function cleanupRecentIntentWindow(now) {
    for (const [key, ts] of recentTrackedIntentAt.entries()) {
      if (now - ts > 2500) recentTrackedIntentAt.delete(key);
    }
  }
  function inferWidgetSource(target, element) {
    const raw = [
      target || "",
      element?.id || "",
      element?.className || "",
      element?.getAttribute?.("data-om-whatsapp") || "",
      element?.getAttribute?.("data-jivo") || "",
      element?.getAttribute?.("aria-label") || ""
    ].join(" ").toLowerCase();
    if (raw.includes("jivo") || raw.includes("jivosite")) return "jivo";
    return "whatsapp";
  }
  function shouldTrackWhatsAppTarget(target) {
    return inferIntentAction(target || "") === "whatsapp";
  }
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
      gbraid: session.gbraid || void 0,
      om_tracker_version: CONFIG.trackerVersion
    };
    if (session.urlParams && typeof session.urlParams === "object") {
      Object.keys(session.urlParams).forEach((k) => {
        if (session.urlParams[k] != null) meta[k] = session.urlParams[k];
      });
    }
    const hw = getHardwareMeta();
    Object.assign(meta, hw);
    const scriptTag2 = getTrackerScriptTag();
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
  function buildCallIntentMeta(target) {
    const intentAction = inferIntentAction(target || "");
    const intentTarget = normalizePhoneTarget(target || "");
    const intentStamp = makeIntentStamp(intentAction === "whatsapp" ? "wa" : "tel", intentTarget);
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
        return new URL(window.location.href).pathname || "/";
      } catch {
        return "/";
      }
    })();
    const rawAction = form?.getAttribute?.("action") || "";
    let actionPath = "";
    if (rawAction) {
      try {
        actionPath = new URL(rawAction, window.location.href).pathname || "";
      } catch {
        actionPath = rawAction;
      }
    }
    const formIdentity = form?.id || form?.getAttribute?.("name") || form?.getAttribute?.("data-form-name") || actionPath || currentPath || "unknown";
    const controls = Array.from(form?.querySelectorAll?.("input, textarea, select") || []).filter((el) => el && !el.disabled);
    const visibleControls = controls.filter((el) => {
      const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : { width: 0, height: 0 };
      return !el.hidden && style?.display !== "none" && style?.visibility !== "hidden" && (rect.width > 0 || rect.height > 0);
    });
    const inferFieldRole = (el) => {
      const raw = [
        el?.type || "",
        el?.name || "",
        el?.id || "",
        el?.autocomplete || "",
        el?.placeholder || "",
        el?.getAttribute?.("aria-label") || ""
      ].join(" ").toLowerCase();
      return {
        hasPhoneField: raw.includes("phone") || raw.includes("tel") || raw.includes("gsm") || raw.includes("mobile"),
        hasEmailField: raw.includes("email") || raw.includes("mail"),
        hasNameField: raw.includes("name") || raw.includes("ad") || raw.includes("soyad"),
        hasMessageField: raw.includes("message") || raw.includes("mesaj") || raw.includes("note") || raw.includes("comment"),
        hasFileField: (el?.type || "").toLowerCase() === "file" || raw.includes("file") || raw.includes("upload")
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
      method: String(form?.getAttribute?.("method") || "get").trim().toLowerCase() || "get",
      action_path: actionPath || currentPath,
      field_count: controls.length,
      visible_field_count: visibleControls.length,
      required_field_count: controls.filter((el) => !!el.required).length,
      file_input_count: controls.filter((el) => (el?.type || "").toLowerCase() === "file").length,
      textarea_count: controls.filter((el) => el?.tagName === "TEXTAREA").length,
      select_count: controls.filter((el) => el?.tagName === "SELECT").length,
      checkbox_count: controls.filter((el) => (el?.type || "").toLowerCase() === "checkbox").length,
      radio_count: controls.filter((el) => (el?.type || "").toLowerCase() === "radio").length,
      has_phone_field: fieldRoles.hasPhoneField,
      has_email_field: fieldRoles.hasEmailField,
      has_name_field: fieldRoles.hasNameField,
      has_message_field: fieldRoles.hasMessageField,
      has_file_field: fieldRoles.hasFileField
    };
    return {
      intentAction: "form",
      intentTarget: `form:${String(formIdentity).trim() || "unknown"}`,
      intentStamp: makeIntentStamp("form", `${currentPath}|${formIdentity}`),
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
    const controls = Array.from(form?.querySelectorAll?.("input, textarea, select") || []).filter((el) => el && !el.disabled);
    const invalid = controls.filter((el) => {
      try {
        return typeof el.matches === "function" ? el.matches(":invalid") : false;
      } catch {
        return false;
      }
    });
    return {
      invalid_field_count: invalid.length,
      required_invalid_count: invalid.filter((el) => !!el.required).length,
      file_invalid_count: invalid.filter((el) => (el?.type || "").toLowerCase() === "file").length
    };
  }
  function cleanupPendingForms(now = Date.now()) {
    for (let i = pendingFormAttempts.length - 1; i >= 0; i -= 1) {
      const item = pendingFormAttempts[i];
      if (!item || item.resolved || now - item.createdAt > 45e3) {
        pendingFormAttempts.splice(i, 1);
      }
    }
  }
  function emitFormLifecycle(form, eventAction, extraMeta = {}) {
    if (!form) return null;
    const intentMeta = buildFormIntentMeta(form);
    const stage = (eventAction || "").replace(/^form_/, "").replace(/^submit_/, "");
    sendEvent("conversion", eventAction, intentMeta.intentTarget, null, {
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
    const actionPath = intentMeta?.formSummary?.action_path || "";
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
    sendEvent("conversion", eventAction, item.intentTarget, null, {
      intent_action: "form",
      intent_target: item.intentTarget,
      intent_page_url: item.intentPageUrl,
      form_stage: (eventAction || "").replace(/^form_/, "").replace(/^submit_/, ""),
      form_summary: item.formSummary,
      ...item.extraMeta,
      ...extraMeta
    });
    cleanupPendingForms();
    return true;
  }
  function trackFormStart(form, trigger = "interaction") {
    const state = getFormLifecycleState(form);
    if (!state || state.startSent) return;
    state.startSent = true;
    emitFormLifecycle(form, "form_start", {
      form_trigger: trigger
    });
  }
  function trackFormValidationFailure(form, trigger = "invalid") {
    const state = getFormLifecycleState(form);
    if (!state) return;
    const now = Date.now();
    if (now - state.lastValidationAt < 1200) return;
    state.lastValidationAt = now;
    const validation = buildValidationSummary(form);
    emitFormLifecycle(form, "form_submit_validation_failed", {
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
  function trackFormAttempt(form, trigger = "submit") {
    const state = getFormLifecycleState(form);
    if (!state) return null;
    const now = Date.now();
    if (now - state.lastAttemptAt < 900) return null;
    state.lastAttemptAt = now;
    trackFormStart(form, "attempt");
    const intentMeta = emitFormLifecycle(form, "form_submit_attempt", {
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
      document.title || "",
      document.body?.innerText?.slice(0, 4e3) || ""
    ].join(" ").toLowerCase();
    return [
      "thank you",
      "thanks",
      "tesekkur",
      "te\u015Fekk\xFCr",
      "basarili",
      "ba\u015Far\u0131l\u0131",
      "gonderildi",
      "g\xF6nderildi",
      "success",
      "completed"
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
    if (Date.now() - Number(pending.createdAt || 0) > 45e3) return;
    const sourcePath = (() => {
      try {
        return new URL(pending.intentPageUrl).pathname || "/";
      } catch {
        return "";
      }
    })();
    const currentPath = (() => {
      try {
        return new URL(window.location.href).pathname || "/";
      } catch {
        return "";
      }
    })();
    if (currentPath && sourcePath && currentPath !== sourcePath || looksLikeSuccessLocation()) {
      sendEvent("conversion", "form_submit_success", pending.intentTarget, null, {
        intent_action: "form",
        intent_target: pending.intentTarget,
        intent_page_url: pending.intentPageUrl,
        form_stage: "submit_success",
        form_summary: pending.formSummary,
        form_transport: "navigation"
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
    }
  }
  function pickPendingTransport(url, method) {
    cleanupPendingForms();
    const requestMethod = String(method || "GET").trim().toUpperCase();
    if (requestMethod === "GET") return null;
    const requestPath = (() => {
      try {
        return new URL(url, window.location.href).pathname || "/";
      } catch {
        return "";
      }
    })();
    const now = Date.now();
    const candidates = pendingFormAttempts.filter((item) => item && !item.resolved && now - item.createdAt < 15e3);
    for (const item of candidates.reverse()) {
      if (item.actionPath && requestPath && item.actionPath === requestPath) return item;
    }
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }
  function installFormTransportHooks() {
    if (window.__opsmantikFormTransportHooksInstalled) return;
    window.__opsmantikFormTransportHooksInstalled = true;
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function(...args) {
        const input = args[0];
        const init = args[1] || {};
        const url = typeof input === "string" ? input : input?.url || window.location.href;
        const method = init?.method || input?.method || "GET";
        const pending = pickPendingTransport(url, method);
        return originalFetch.apply(this, args).then((response) => {
          if (pending) {
            resolvePendingForm(
              pending,
              response.ok ? "form_submit_success" : "form_submit_network_failed",
              {
                form_transport: "fetch",
                form_http_status: response.status
              }
            );
          }
          return response;
        }).catch((error) => {
          if (pending) {
            resolvePendingForm(pending, "form_submit_network_failed", {
              form_transport: "fetch",
              form_error: String(error?.message || error || "fetch_failed").slice(0, 120)
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
      proto.open = function(method, url, ...rest) {
        this.__opsmantikMethod = method;
        this.__opsmantikUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };
      proto.send = function(...args) {
        const pending = pickPendingTransport(this.__opsmantikUrl || window.location.href, this.__opsmantikMethod || "GET");
        if (pending) {
          this.addEventListener("load", () => {
            resolvePendingForm(
              pending,
              this.status >= 200 && this.status < 400 ? "form_submit_success" : "form_submit_network_failed",
              {
                form_transport: "xhr",
                form_http_status: this.status
              }
            );
          }, { once: true });
          this.addEventListener("error", () => {
            resolvePendingForm(pending, "form_submit_network_failed", {
              form_transport: "xhr",
              form_error: "xhr_error"
            });
          }, { once: true });
          this.addEventListener("abort", () => {
            resolvePendingForm(pending, "form_submit_network_failed", {
              form_transport: "xhr",
              form_error: "xhr_abort"
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
    if (now - lastTrackedAt < 1800) return false;
    recentTrackedIntentAt.set(dedupeKey, now);
    sendEvent("conversion", eventAction, label, null, {
      intent_stamp: intentMeta.intentStamp,
      intent_action: intentMeta.intentAction,
      intent_target: intentMeta.intentTarget,
      intent_page_url: intentMeta.intentPageUrl,
      intent_source: source,
      ...element?.id ? { intent_element_id: element.id } : {}
    });
    sendCallEvent(target, intentMeta);
    return true;
  }
  function extractPhoneIntentFromElement(clickTarget) {
    const el = clickTarget?.closest ? clickTarget.closest('a[href^="tel:"], [data-om-phone], [data-phone], [data-tel], [onclick*="tel:"]') : null;
    if (!el) return null;
    const href = typeof el.getAttribute === "function" ? el.getAttribute("href") : "";
    const dataPhone = typeof el.getAttribute === "function" ? el.getAttribute("data-om-phone") || el.getAttribute("data-phone") || el.getAttribute("data-tel") || "" : "";
    const onClickAttr = typeof el.getAttribute === "function" ? el.getAttribute("onclick") || "" : "";
    const telFromOnClick = (() => {
      const m = onClickAttr.match(/tel:[^'"\\)\s]+/i);
      return m ? m[0] : "";
    })();
    const candidate = href?.startsWith("tel:") ? href : dataPhone ? dataPhone.startsWith("tel:") ? dataPhone : `tel:${dataPhone}` : telFromOnClick;
    if (!candidate || !candidate.toLowerCase().startsWith("tel:")) return null;
    return { target: candidate, element: el };
  }
  function installOutboundIntentHooks() {
    if (window.__opsmantikIntentHooksInstalled) return;
    window.__opsmantikIntentHooksInstalled = true;
    document.addEventListener("pointerdown", (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-om-whatsapp], a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="joinchat"], a[href^="whatsapp://"], a[href^="whatsapp:"], [class*="joinchat"], [class*="jivo"], [id*="jivo"]') : null;
      if (!el) return;
      lastPointerContext = {
        ts: Date.now(),
        element: el
      };
    }, true);
    const originalOpen = window.open;
    if (typeof originalOpen === "function") {
      window.open = function(...args) {
        const target = typeof args[0] === "string" ? args[0] : "";
        if (target && shouldTrackWhatsAppTarget(target)) {
          const recentElement = lastPointerContext && Date.now() - lastPointerContext.ts < 2e3 ? lastPointerContext.element : null;
          emitTrackedIntent(target, "whatsapp", target, inferWidgetSource(target, recentElement), recentElement);
        }
        return originalOpen.apply(this, args);
      };
    }
  }
  function sendCallEvent(phoneNumber, intentMeta = null) {
    if (!siteId) return;
    const session = getOrCreateSession();
    const base = CONFIG.apiUrl ? CONFIG.apiUrl.replace(/\/api\/sync\/?$/, "") : window.location.origin;
    const callEventUrl = base + "/api/call-event/v2";
    const scriptTag2 = getTrackerScriptTag();
    const proxyUrl2 = scriptTag2?.getAttribute("data-ops-proxy-url") || (window.opsmantikConfig || window.opmantikConfig || {})?.opsProxyUrl || "";
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
    if (proxyUrl2) {
      fetch(proxyUrl2, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(function(e) {
        if (typeof console !== "undefined") console.warn("[OpsMantik] TRACKER_FETCH_FAILED", "call-event", e?.message || e);
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
    if (typeof console !== "undefined") {
      console.warn("[OpsMantik] call-event sent unsigned: missing proxyUrl or signing secret");
    }
    fetch(callEventUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    }).catch(function() {
    });
  }
  function sendPageViewPulse() {
    return;
  }
  function initAutoTracking() {
    console.log("[OPSMANTIK] Auto-tracking initialized");
    sendEvent("interaction", "view", document.title);
    sendPageViewPulse();
    installOutboundIntentHooks();
    installFormTransportHooks();
    flushPendingNavigationOutcome();
    document.addEventListener("click", (e) => {
      const phoneIntent = extractPhoneIntentFromElement(e.target);
      if (phoneIntent) {
        emitTrackedIntent(phoneIntent.target, "phone_call", phoneIntent.target, "phone", phoneIntent.element);
        return;
      }
      const dataWa = e.target.closest && e.target.closest("[data-om-whatsapp]");
      if (dataWa && dataWa.getAttribute("data-om-whatsapp")) {
        const href = dataWa.getAttribute("data-om-whatsapp");
        emitTrackedIntent(href, "whatsapp", href, inferWidgetSource(href, dataWa), dataWa);
      } else {
        const wa = e.target.closest('a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="joinchat"], a[href^="whatsapp://"], a[href^="whatsapp:"]');
        if (wa) {
          emitTrackedIntent(wa.href, "whatsapp", wa.href, inferWidgetSource(wa.href, wa), wa);
        }
      }
    });
    document.addEventListener("submit", (e) => {
      if (e.target.tagName === "FORM") {
        trackFormAttempt(e.target, "submit");
      }
    }, true);
    document.addEventListener("focusin", (e) => {
      const form = e.target?.closest?.("form");
      if (form) trackFormStart(form, "focus");
    }, true);
    document.addEventListener("input", (e) => {
      const form = e.target?.closest?.("form");
      if (form) trackFormStart(form, "input");
    }, true);
    document.addEventListener("invalid", (e) => {
      const form = e.target?.closest?.("form");
      if (form) {
        trackFormStart(form, "invalid");
        trackFormValidationFailure(form, "invalid");
      }
    }, true);
    const formProto = window.HTMLFormElement && window.HTMLFormElement.prototype;
    if (formProto && !formProto.__opsmantikWrapped) {
      const originalRequestSubmit = formProto.requestSubmit;
      const originalNativeSubmit = formProto.submit;
      if (typeof originalRequestSubmit === "function") {
        formProto.requestSubmit = function(...args) {
          trackFormAttempt(this, "request_submit");
          return originalRequestSubmit.apply(this, args);
        };
      }
      if (typeof originalNativeSubmit === "function") {
        formProto.submit = function(...args) {
          trackFormAttempt(this, "native_submit");
          return originalNativeSubmit.apply(this, args);
        };
      }
      formProto.__opsmantikWrapped = true;
    }
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
      const cta = e.target.closest && e.target.closest('a[href^="tel:"], a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="joinchat"], a[href^="whatsapp://"], a[href^="whatsapp:"], [data-om-whatsapp], [data-om-cta="true"]');
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
      stashPendingNavigationAttempt();
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
