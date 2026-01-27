(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    apiUrl: window.location.origin + '/api/sync',
    sessionKey: 'opmantik_session_sid',
    fingerprintKey: 'opmantik_session_fp',
    contextKey: 'opmantik_session_context',
    heartbeatInterval: 30000, // 30 seconds
    sessionTimeout: 1800000, // 30 minutes
  };

  // Check if API URL is accessible (for debugging)
  if (typeof window !== 'undefined') {
    console.log('[OPSMANTIK] API URL:', CONFIG.apiUrl);
  }

  // Prevent duplicate initialization
  if (window.opmantik && window.opmantik._initialized) {
    console.warn('[OPSMANTIK] Tracker already initialized, skipping...');
    return;
  }

  // Get site ID from script tag
  const scriptTag = document.currentScript || document.querySelector('script[data-site-id]');
  const siteId = scriptTag?.getAttribute('data-site-id') || '';

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
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
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

  function makeIntentStamp(actionShort, target) {
    const ts = Date.now();
    const tHash = hash6((target || '').toString().toLowerCase());
    return `${ts}-${rand4()}-${actionShort}-${tHash}`;
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

  // Offline queue helpers (localStorage, max 10 items, TTL 1h)
  function queueEvent(payload) {
    try {
      const queueKey = 'opsmantik_evtq_v1';
      const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
      const now = Date.now();
      
      // Add timestamp and limit to 10 items
      queue.push({ payload, ts: now });
      const trimmed = queue.slice(-10);
      
      localStorage.setItem(queueKey, JSON.stringify(trimmed));
      if (localStorage.getItem('opsmantik_debug') === '1') {
        console.log('[track] queued:', payload.ec + '/' + payload.ea, payload.sid.slice(0, 8), payload.u);
      }
    } catch (err) {
      // Silent fail - never block UI
    }
  }

  function drainQueue() {
    try {
      const queueKey = 'opsmantik_evtq_v1';
      const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
      const now = Date.now();
      const TTL = 60 * 60 * 1000; // 1 hour
      
      const remaining = [];
      queue.forEach(item => {
        if (now - item.ts < TTL) {
          const sent = navigator.sendBeacon && navigator.sendBeacon(
            CONFIG.apiUrl,
            new Blob([JSON.stringify(item.payload)], { type: 'application/json' })
          );
          if (!sent) {
            remaining.push(item); // Keep for next attempt
          }
        }
        // Items older than TTL are dropped
      });
      
      if (remaining.length > 0) {
        localStorage.setItem(queueKey, JSON.stringify(remaining));
      } else {
        localStorage.removeItem(queueKey);
      }
    } catch (err) {
      // Silent fail
    }
  }

  // Send event to API with guaranteed delivery (sendBeacon + keepalive fallback)
  function sendEvent(category, action, label, value, metadata = {}) {
    const { sessionId, fingerprint, context } = getOrCreateSession();
    const url = window.location.href;
    const referrer = document.referrer || '';
    const sessionMonth = new Date().toISOString().slice(0, 7) + '-01';

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
      meta: {
        fp: fingerprint,
        gclid: context,
        ...metadata,
      },
    };

    // Debug logging (conditional)
    const isDebug = typeof window !== 'undefined' && 
                    (localStorage.getItem('opsmantik_debug') === '1' ||
                     localStorage.getItem('WARROOM_DEBUG') === 'true');
    
    if (isDebug) {
      console.log('[OPSMANTIK] Sending event payload:', {
        category,
        action,
        label,
        value,
        sessionId: sessionId.slice(0, 8) + '...',
        url,
        referrer,
        meta: {
          fp: fingerprint,
          gclid: context,
          ...metadata,
        },
      });
    } else {
      console.log('[OPSMANTIK] Sending event:', {
        category,
        action,
        label,
        value,
        sessionId: sessionId.slice(0, 8) + '...',
      });
    }

    // P0 FIX: Use sendBeacon for guaranteed delivery (especially for tel:/wa.me navigation)
    let sent = false;
    let method = '';

    // Attempt 1: sendBeacon (guaranteed delivery even on navigation)
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      sent = navigator.sendBeacon(CONFIG.apiUrl, blob);
      if (sent) {
        method = 'beacon';
      }
    }

    // Attempt 2: fetch with keepalive (fallback if beacon fails)
    if (!sent) {
      fetch(CONFIG.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        mode: 'cors',
        credentials: 'omit',
        keepalive: true, // ✅ Ensures completion after navigation
      })
      .then(response => {
        if (response.ok) {
          method = 'fallback';
          if (localStorage.getItem('opsmantik_debug') === '1') {
            console.log('[track] fallback:', category + '/' + action, sessionId.slice(0, 8), url);
          }
        } else {
          // Server rejected - queue for retry
          queueEvent(payload);
        }
      })
      .catch(err => {
        // Network error - queue for retry
        queueEvent(payload);
      });
      method = 'fallback'; // Optimistic
    }

    // Debug transport proof
    if (localStorage.getItem('opsmantik_debug') === '1' && method === 'beacon') {
      console.log('[track] sent:', category + '/' + action, sessionId.slice(0, 8), url);
    }
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

    // Scroll depth
    let maxScroll = 0;
    window.addEventListener('scroll', () => {
      const scrollPercent = Math.round(
        ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100
      );
      if (scrollPercent > maxScroll) {
        maxScroll = scrollPercent;
        if (scrollPercent >= 50 && scrollPercent < 90) {
          sendEvent('interaction', 'scroll_depth', '50%', scrollPercent);
        } else if (scrollPercent >= 90) {
          sendEvent('interaction', 'scroll_depth', '90%', scrollPercent);
        }
      }
    });

    // Heartbeat
    setInterval(() => {
      sendEvent('system', 'heartbeat', 'session_active');
    }, CONFIG.heartbeatInterval);

    // Session end
    window.addEventListener('beforeunload', () => {
      sendEvent('system', 'session_end', 'page_unload', null, {
        exit_page: window.location.href,
      });
    });
  }

  // Public API
  window.opmantik = {
    send: sendEvent,
    session: getOrCreateSession,
    _initialized: true, // Prevent duplicate initialization
  };

  // Drain offline queue on load
  drainQueue();

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoTracking);
  } else {
    initAutoTracking();
  }
})();
