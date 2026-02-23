# SECTOR ALPHA / BRAVO / CHARLIE — Raw Blueprints

**Status:** Standing by.  
**Date:** 2026-01-29  
**Target:** sessions, events, calls schema | ux-core.js tracker | Sync API route.

---

## 1. SECTOR ALPHA: DATABASE SCHEMA

### 1.1 Table definitions (SQL)

**sessions** (partitioned by month)

```sql
-- From 20260125000000_initial_schema.sql
CREATE TABLE IF NOT EXISTS sessions (
    id UUID NOT NULL,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    ip_address INET,
    entry_page TEXT,
    exit_page TEXT,
    gclid TEXT,
    wbraid TEXT,
    gbraid TEXT,
    total_duration_sec INTEGER DEFAULT 0,
    event_count INTEGER DEFAULT 0,
    created_month DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, created_month)
) PARTITION BY RANGE (created_month);

-- Added by 20260125225000_add_sessions_attribution_columns.sql
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS attribution_source TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS fingerprint TEXT;
```

**events** (partitioned by month)

```sql
-- From 20260125000000_initial_schema.sql
CREATE TABLE IF NOT EXISTS events (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    session_month DATE NOT NULL,
    url TEXT NOT NULL,
    event_category TEXT NOT NULL,
    event_action TEXT NOT NULL,
    event_label TEXT,
    event_value NUMERIC,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, session_month),
    FOREIGN KEY (session_id, session_month) REFERENCES sessions(id, created_month) ON DELETE CASCADE
) PARTITION BY RANGE (session_month);
```

**calls** (non-partitioned)

```sql
-- From 20260125000000_initial_schema.sql
CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    matched_session_id UUID,
    matched_fingerprint TEXT,
    lead_score INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 20260125000003_add_call_status.sql
ALTER TABLE calls ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('qualified', 'junk') OR status IS NULL);

-- 20260125000004_enrich_call_matching.sql
ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_score_at_match INTEGER,
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ;

-- 20260125232000_add_call_intent_columns.sql
ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_status_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_status_check
  CHECK (status IN ('intent', 'confirmed', 'junk', 'qualified', 'real') OR status IS NULL);
ALTER TABLE public.calls ALTER COLUMN status SET DEFAULT 'intent';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'click';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS note TEXT;

-- 20260128036000_calls_intent_stamp.sql
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS intent_stamp TEXT,
  ADD COLUMN IF NOT EXISTS intent_action TEXT,
  ADD COLUMN IF NOT EXISTS intent_target TEXT;

-- 20260128036100_calls_intent_stamp_unique_constraint.sql
ALTER TABLE public.calls ADD CONSTRAINT calls_site_intent_stamp_uniq UNIQUE (site_id, intent_stamp);

-- 20260128038000_calls_inbox_fields.sql
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS intent_page_url TEXT,
  ADD COLUMN IF NOT EXISTS click_id TEXT;
```

### 1.2 Partition setup (active)

- **sessions:** `PARTITION BY RANGE (created_month)`. Partitions created only at migration time for **current month**:
  - `sessions_YYYY_MM` FOR VALUES FROM (current_month) TO (next_month)
- **events:** `PARTITION BY RANGE (session_month)`. Same: **current month** only at migration:
  - `events_YYYY_MM` FOR VALUES FROM (current_month) TO (next_month)
- **calls:** Not partitioned.

Partition creation (initial_schema.sql):

```sql
DO $$
DECLARE
    current_month DATE := DATE_TRUNC('month', CURRENT_DATE);
    next_month DATE := current_month + INTERVAL '1 month';
    partition_name_sessions TEXT;
    partition_name_events TEXT;
BEGIN
    partition_name_sessions := 'sessions_' || TO_CHAR(current_month, 'YYYY_MM');
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF sessions FOR VALUES FROM (%L) TO (%L)',
        partition_name_sessions, current_month, next_month);
    partition_name_events := 'events_' || TO_CHAR(current_month, 'YYYY_MM');
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
        partition_name_events, current_month, next_month);
END $$;
```

Realtime (20260125000002_realtime_setup.sql):

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE calls;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER TABLE events REPLICA IDENTITY FULL;
ALTER TABLE sessions REPLICA IDENTITY FULL;
ALTER TABLE calls REPLICA IDENTITY FULL;
```

### 1.3 Indexes (performance constraints)

**sessions**

- `idx_sessions_site_id` ON sessions(site_id)
- `idx_sessions_created_month` ON sessions(created_month)
- `idx_sessions_attribution_source` ON sessions(attribution_source) WHERE attribution_source IS NOT NULL
- `idx_sessions_device_type` ON sessions(device_type) WHERE device_type IS NOT NULL
- `idx_sessions_fingerprint` ON sessions(fingerprint) WHERE fingerprint IS NOT NULL
- `idx_sessions_site_month_date` ON sessions(site_id, created_month, created_at)

**events**

- `idx_events_session_id` ON events(session_id)
- `idx_events_session_month` ON events(session_month)
- `idx_events_category` ON events(event_category)
- `idx_events_created_at` ON events(created_at)
- `idx_events_month_category` ON events(session_month, event_category) WHERE event_category = 'conversion'
- `idx_events_session_month_date` ON events(session_id, session_month, created_at)

**calls**

- `idx_calls_site_id` ON calls(site_id)
- `idx_calls_matched_session` ON calls(matched_session_id)
- `idx_calls_status` ON calls(status) WHERE status IS NOT NULL
- `idx_calls_matched_at` ON calls(matched_at) WHERE matched_at IS NOT NULL
- `idx_calls_source` ON calls(source) WHERE source IS NOT NULL
- `idx_calls_status_intent` ON calls(status) WHERE status = 'intent'
- `idx_calls_confirmed_at` ON calls(confirmed_at) WHERE confirmed_at IS NOT NULL
- `idx_calls_dedupe_intent` ON calls(site_id, matched_session_id, source, created_at) WHERE status = 'intent'
- `idx_calls_site_intent_stamp_uniq` UNIQUE ON calls(site_id, intent_stamp) WHERE intent_stamp IS NOT NULL
- `idx_calls_intent_fallback_dedupe` ON calls(site_id, matched_session_id, intent_action, intent_target, created_at) WHERE source = 'click' AND (status = 'intent' OR status IS NULL)
- `idx_calls_site_source_created_at` ON calls(site_id, source, created_at DESC)
- `idx_calls_site_date` ON calls(site_id, created_at)

---

## 2. SECTOR BRAVO: FIELD OPERATIVE (TRACKER)

**Target:** `public/ux-core.js`  
**Focus:** sendBeacon, fetch fallback, queue mechanism.

### 2.1 Config and queue helpers

```javascript
  const CONFIG = {
    apiUrl: window.location.origin + '/api/sync',
    sessionKey: 'opmantik_session_sid',
    fingerprintKey: 'opmantik_session_fp',
    contextKey: 'opmantik_session_context',
    heartbeatInterval: 30000,
    sessionTimeout: 1800000,
  };

  // Offline queue helpers (localStorage, max 10 items, TTL 1h)
  function queueEvent(payload) {
    try {
      const queueKey = 'opsmantik_evtq_v1';
      const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
      const now = Date.now();
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
            remaining.push(item);
          }
        }
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
```

### 2.2 sendEvent: sendBeacon + fetch fallback

```javascript
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
      meta: { fp: fingerprint, gclid: context, ...metadata },
    };

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
      })
      .then(response => {
        if (response.ok) {
          method = 'fallback';
          if (localStorage.getItem('opsmantik_debug') === '1') {
            console.log('[track] fallback:', category + '/' + action, sessionId.slice(0, 8), url);
          }
        } else {
          queueEvent(payload);
        }
      })
      .catch(err => {
        queueEvent(payload);
      });
      method = 'fallback';
    }

    if (localStorage.getItem('opsmantik_debug') === '1' && method === 'beacon') {
      console.log('[track] sent:', category + '/' + action, sessionId.slice(0, 8), url);
    }
  }
```

### 2.3 Init: drain on load

```javascript
  drainQueue();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoTracking);
  } else {
    initAutoTracking();
  }
```

---

## 3. SECTOR CHARLIE: SYNC GATEWAY (API)

**Target:** `app/api/sync/route.ts`  
**Focus:** How intel enters — INSERT logic and error handling.

### 3.1 Entry: CORS, rate limit, body parse, validation

- CORS: `isOriginAllowed(origin, ALLOWED_ORIGINS)` → 403 + `createSyncResponse(false, null, { error: 'Origin not allowed', ... })`.
- Rate limit: `rateLimit(clientId, 100, 60*1000)` → 429 + `createSyncResponse(false, null, { error: 'Rate limit exceeded', retryAfter, ... })`.
- Body: `req.json()` → on parse error → 400 + `createSyncResponse(false, null, { message: 'Invalid JSON payload' })`.
- Payload: `site_id` (rawBody.s), `url` (rawBody.u) required; missing → 200 + `createSyncResponse(true, 0, { status: 'synced_skipped_missing_id' })`.
- site_id: normalized to UUID v4; invalid → 400 + `createSyncResponse(false, null, { message: 'Invalid site_id format' })`.
- url: `new URL(url)` → invalid → 400 + `createSyncResponse(false, null, { message: 'Invalid url format' })`.
- Site lookup: `adminClient.from('sites').select('id').in('public_id', searchIds).maybeSingle()` → siteError → 500 “Site validation failed”; no site → 404 “Site not found”.

### 3.2 INSERT logic (sessions → events → calls)

**Step A – Session lookup (existing partition)**

```typescript
const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = uuidV4Regex.test(client_sid);
const dbMonth = session_month || new Date().toISOString().slice(0, 7) + '-01';

if (isUuid) {
  const { data: existingSession, error: lookupError } = await adminClient
    .from('sessions')
    .select('id, created_month, attribution_source, gclid')
    .eq('id', client_sid)
    .eq('created_month', dbMonth)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      createSyncResponse(false, null, { message: 'Session lookup failed', details: lookupError.message }),
      { status: 500, headers: baseHeaders }
    );
  }
  if (existingSession) {
    session = existingSession;
    // optional update attribution if missing
  }
}
```

**Step B – Session INSERT (if not found)**

```typescript
if (!session) {
  const finalSessionId = isUuid ? client_sid : generateUUID();
  const sessionPayload = {
    id: finalSessionId,
    site_id: site.id,
    ip_address: ip,
    entry_page: url,
    gclid: currentGclid,
    wbraid: params.get('wbraid') || meta?.wbraid,
    gbraid: params.get('gbraid') || meta?.gbraid,
    created_month: dbMonth,
    attribution_source: attributionSource,
    device_type: deviceType,
    city: geoInfo.city !== 'Unknown' ? geoInfo.city : null,
    district: geoInfo.district,
    fingerprint: fingerprint,
  };
  const { data: newSession, error: sError } = await adminClient
    .from('sessions')
    .insert(sessionPayload)
    .select('id, created_month')
    .single();
  if (sError) {
    console.error('[SYNC_API] Session insert failed:', { ... });
    throw sError;
  }
  session = newSession;
}
```

**Step C – Event INSERT**

```typescript
if (session) {
  let finalCategory = event_category || 'interaction';
  if (currentGclid && event_category !== 'system' && event_category !== 'conversion') {
    finalCategory = 'acquisition';
  }
  const { error: eError } = await adminClient
    .from('events')
    .insert({
      session_id: session.id,
      session_month: session.created_month,
      url: url,
      event_category: finalCategory,
      event_action: event_action || 'view',
      event_label: event_label,
      event_value: event_value ? Number(event_value) : null,
      metadata: { referrer, ...meta, client_sid, fingerprint: fingerprint, user_agent: userAgent, ...deviceInfo, ...geoInfo, lead_score: leadScore, attribution_source: attributionSource, intelligence_summary: summary, is_attributed_to_ads: !!currentGclid, gclid: currentGclid, ip_anonymized: ip.replace(/\.\d+$/, '.0') },
    });
  if (eError) {
    console.error('[SYNC_API] Event insert failed:', { ... });
    throw eError;
  }
  // Step D: click-intent → calls upsert/insert (see below)
  // Session metadata update for heartbeat/session_end
}
```

**Step D – Call intent (calls) upsert/insert**

- Condition: `shouldCreateIntent` (phone/wa action + session + fingerprint/session.id).
- Preferred: `adminClient.from('calls').upsert({ site_id, phone_number, matched_session_id, matched_fingerprint, lead_score, lead_score_at_match, status: 'intent', source: 'click', intent_stamp, intent_action, intent_target, intent_page_url, click_id }, { onConflict: 'site_id,intent_stamp', ignoreDuplicates: true })`. On upsert error → fallback.
- Fallback: select existing intent in last 10s (site_id, matched_session_id, source, intent_action, intent_target); if none → `adminClient.from('calls').insert({ ... })`. On insert error 23505 → log dedupe; else log warning.

### 3.3 Error handling blocks

**DB try/catch (sessions/events/calls write path)**

```typescript
} catch (dbError) {
  const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
  const errorStack = dbError instanceof Error ? dbError.stack : undefined;
  const errorCode = (dbError as unknown as { code?: string })?.code;
  const errorDetails = (dbError as unknown as { details?: string })?.details;
  console.error('[PARTITION_FAULT] DB Write Failed:', {
    message: errorMessage, code: errorCode, details: errorDetails, stack: errorStack,
    site_id: rawBody.s, session_id: client_sid, timestamp: new Date().toISOString()
  });
  return NextResponse.json(
    createSyncResponse(false, null, { message: 'Database write failed' }),
    { status: 500, headers: baseHeaders }
  );
}
```

**Top-level catch (uncaught in POST)**

```typescript
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  const origin = req.headers.get('origin');
  console.error('[SYNC_API] Tracking Error:', { message: errorMessage, stack: errorStack, timestamp: new Date().toISOString(), url: req.url });
  const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);
  const errorHeaders = { 'Vary': 'Origin', 'X-OpsMantik-Version': OPSMANTIK_VERSION, 'X-CORS-Reason': reason || 'unknown_error' };
  if (isAllowed && origin) {
    errorHeaders['Access-Control-Allow-Origin'] = origin;
    errorHeaders['Access-Control-Allow-Credentials'] = 'true';
  }
  return NextResponse.json(
    createSyncResponse(false, null, { message: errorMessage }),
    { status: 500, headers: errorHeaders }
  );
}
```

### 3.4 Success response

```typescript
return NextResponse.json(
  createSyncResponse(true, leadScore, { status: 'synced' }),
  { headers: { ...baseHeaders, 'X-RateLimit-Limit': '100', 'X-RateLimit-Remaining': rateLimitResult.remaining.toString() } }
);
```

---

**END OF BLUEPRINTS. STATUS: STANDING BY.**
