# /api/sync 429 Baseline Audit — Poyraz Antika vs Other Sites

**Goal:** Explain why 429 occurs on poyrazantika.com but not others; quantify request rate. No behavior changes (baseline only).

---

## 1) Call Graph

### 1.1 core.js → outbox → processOutbox → POST /api/sync

| Step | File | Function / location | Line(s) |
|------|------|---------------------|--------|
| Entry (init guard) | `public/assets/core.js` | IIFE start, duplicate check | 9–12 |
| Init log | `public/assets/core.js` | after siteId check | 74 |
| **addToOutbox** | `public/assets/core.js` | `addToOutbox(payload)` | 229–238 |
| → getQueue | `public/assets/core.js` | `getQueue()` | 214–220 |
| → saveQueue | `public/assets/core.js` | `saveQueue(queue)` | 223–226 |
| → **processOutbox** | `public/assets/core.js` | tail of addToOutbox | 238 |
| **processOutbox** | `public/assets/core.js` | `async function processOutbox()` | 243–286 |
| → fetch | `public/assets/core.js` | `fetch(syncUrl.toString(), { method: 'POST', ... })` | 258–266 |
| Server | `app/api/sync/route.ts` | POST handler | 141+ |
| Rate limit | `app/api/sync/route.ts` | `RateLimitService.check(getClientId(req), 100, 60000)` | 161–167 |

### 1.2 Heartbeat scheduling path

| Step | File | Location | Line(s) |
|------|------|----------|--------|
| CONFIG | `public/assets/core.js` | `heartbeatInterval: 60000` | 60 |
| Timer | `public/assets/core.js` | `setInterval(() => { sendEvent('system', 'heartbeat', 'session_active'); }, CONFIG.heartbeatInterval)` | 499–501 |
| sendEvent | `public/assets/core.js` | `sendEvent(category, action, label, ...)` | 287–330 |
| addToOutbox | `public/assets/core.js` | end of sendEvent | 328 |
| processOutbox | `public/assets/core.js` | from addToOutbox | 238 |

### 1.3 Auto-tracking (view / interaction) paths

| Trigger | File | Call path | Line(s) |
|---------|------|-----------|--------|
| Page view | `public/assets/core.js` | `initAutoTracking()` → `sendEvent('interaction', 'view', document.title)` | 415–416 |
| Phone click | `public/assets/core.js` | click listener → `sendEvent('conversion', 'phone_call', ...)` + `sendCallEvent()` | 420–429 |
| WhatsApp click | `public/assets/core.js` | click listener → `sendEvent('conversion', 'whatsapp', ...)` + `sendCallEvent()` | 434–436 |
| Form submit | `public/assets/core.js` | submit listener → `sendEvent('conversion', 'form_submit', ...)` | 445–446 |
| Scroll 50% | `public/assets/core.js` | scroll listener → `sendEvent('interaction', 'scroll_depth', '50%', ...)` | 460–462 |
| Scroll 90% | `public/assets/core.js` | scroll listener → `sendEvent('interaction', 'scroll_depth', '90%', ...)` | 463–464 |
| Session end | `public/assets/core.js` | beforeunload → `sendEvent('system', 'session_end', ...)` | 504–509 |

Note: `sendCallEvent()` posts to `/api/call-event/v2`, not to outbox/sync. Only `sendEvent(...)` enqueues to outbox and thus hits `/api/sync`.

### 1.4 processOutbox continuation / retry

| Event | File | Location | Line(s) |
|-------|------|----------|--------|
| Success | `public/assets/core.js` | `if (response.ok)` → shift, saveQueue, processOutbox() | 268–275 |
| Non-OK (e.g. 429) | `public/assets/core.js` | `else { throw new Error('Server status: ' + response.status) }` | 276–277 |
| Catch (retry) | `public/assets/core.js` | `catch (err)` → attempts++, saveQueue, `setTimeout(processOutbox, 5000)` | 279–284 |
| On load | `public/assets/core.js` | DOMContentLoaded or else → processOutbox() | 521–526 |
| On online | `public/assets/core.js` | `window.addEventListener('online', processOutbox)` | 530 |

---

## 2) Traffic Model

### 2.1 Triggers that enqueue envelopes (hit /api/sync)

- **view** — 1 per page load (initAutoTracking).
- **heartbeat** — 1 every 60s per tab (`CONFIG.heartbeatInterval` = 60000).
- **session_end** — 0 or 1 per tab (beforeunload; may not fire if kill).
- **scroll_depth** — 0–2 per tab (50% and 90% once each).
- **phone_call** / **whatsapp** / **form_submit** — N per user actions (unbounded but typically low).
- **conversion** (other) — any explicit `opmantik.send(...)`.

### 2.2 Estimate: requests/min per tab (steady state)

- Heartbeat: **1 req/min**.
- View: **~0.017 req/min** if we assume one view per 60s average (or 1 on load only → 0.0167/min for a 1‑minute stay).
- Scroll: 0–2 per session; amortized per minute **&lt; 0.1** for a typical 2–5 min stay.
- Clicks/conversions: **&lt; 1/min** unless very click-heavy.

**Rough total per tab:** **~1–2 req/min** in steady state (heartbeat-dominated). On load: 1 view + 1 heartbeat within first minute → **2 in first minute**, then **1/min**.

### 2.3 When 100/min is exceeded

- **Tabs:** 50+ tabs (same origin) × 1 heartbeat/min ≈ 50+ req/min; more with views/interactions.
- **Retry storm:** After first 429, every 5s one retry (same envelope) + new heartbeats and views from same tab → **12 retries/min** for that envelope plus normal traffic → accelerates exhaustion.
- **Multi-tab + retry:** Many tabs all getting 429 and retrying every 5s → request rate multiplies.

---

## 3) Rate Limit Model

### 3.1 Server values

| Setting | File | Line | Value |
|--------|------|------|--------|
| Limit | `app/api/sync/route.ts` | 163 | **100** |
| Window | `app/api/sync/route.ts` | 163 | **60000** (ms) = 1 minute |
| Key | `lib/services/rate-limit-service.ts` | 102–122 | **getClientId(req)** |

### 3.2 Keying (clientId)

```ts
// lib/services/rate-limit-service.ts, getClientId(req)
ip = cf-connecting-ip || x-forwarded-for (first) || x-real-ip || true-client-ip || 'unknown'
uaKey = (user-agent || '').trim().slice(0, 64)
return `${ip}|${uaKey}`
```

- **Key = IP + UA (first 64 chars).** Not site_id, not session.
- **Multi-site collision:** All sites served to the same client (same IP + UA) share one bucket. So 60 req/min from Site A + 50 from Site B = 110 → 429 for that client even if each site alone is under 100.

**Update (site-scoped rate limit):** The sync route now uses a **site-scoped** rate limit key when the request body includes a valid `siteId` (`body.s` or, for batch, `events[0].s`): key = **`${siteId}:${clientId}`**. If `siteId` is missing or invalid, it falls back to **`clientId`** only. So each site has its own 100/60s bucket per client; **Poyraz Antika no longer throttles other sites** on the same IP+UA. See **SYNC_429_P0_VERIFICATION.md** (“Rate limit: site-scoped”).

### 3.3 Poyraz Antika–specific implication

- If Poyraz Antika gets more traffic from the same IPs (e.g. office, single region, or one heavy user with many tabs), that IP’s 100/min is consumed by Poyraz Antika traffic.
- Other sites may have different visitor IPs or lower traffic per IP, so they stay under 100/min per clientId.

---

## 4) Poyraz-Specific Hypotheses (Ranked)

### H1: Retry storm (429 → 5s retry → repeat)

- **Idea:** First 429 causes 5s retry; next attempt again 429 → again 5s; meanwhile heartbeats and other events keep enqueueing. Same IP gets 12+ retries/min plus new traffic → sustained &gt;100/min.
- **Evidence:** Console: `[TankTracker] Network Fail - Retrying later: Server status: 429` every ~5s; queue not draining.
- **Confirm:** Enable DEBUG; check “flush attempts” log for status 429 and “next retry 5s”; count logs per minute.

### H2: Multiple tabs (same origin)

- **Idea:** Many tabs open on Poyraz Antika → each tab: 1 view on load + 1 heartbeat/min + possible scroll/clicks. 50 tabs ≈ 50+ req/min from one IP.
- **Evidence:** Single user with many tabs; or shared device (e.g. kiosk).
- **Confirm:** DEBUG “queue length on enqueue” + “tracker init”; if many inits or queue growing with heartbeat pattern across tabs (e.g. same session IDs or many), multi-tab likely.

### H3: Duplicate tracker init

- **Idea:** Script injected twice (e.g. GTM + direct, or two GTM tags) → two setIntervals for heartbeat → 2 req/min per tab from heartbeats alone; plus duplicate view on load.
- **Evidence:** Console shows `[OPSMANTIK] Tracker already initialized, skipping...` only once; if seen multiple times or never and heartbeats double, suspect duplicate.
- **Confirm:** DEBUG “tracker init” (and “init skipped”) once per expected load; if “init” logs more than once per page load, duplicate init.

### H4: Extra events from embeds/widgets

- **Idea:** Iframes or widgets that load the same tracker or fire many clicks/views (e.g. multiple views per embed) → more envelopes per page.
- **Evidence:** Many view/interaction events per minute in queue; or many different session IDs from same page.
- **Confirm:** DEBUG queue length and event types (ea) on enqueue; high view/scroll rate or many conversion events from one page points to embeds/widgets.

---

## 5) DEBUG Instrumentation (Gated)

Gating: `localStorage.getItem('opsmantik_debug') === '1'` (existing flag in core.js).

### 5.1 Queue length on enqueue

- **Where:** `public/assets/core.js`, inside `addToOutbox(payload)`, after `saveQueue(queue)` and before `processOutbox()` (e.g. after line 236).
- **Log:**  
  `console.log('[OPSMANTIK_DEBUG] enqueue', { ea: payload.ea, ec: payload.ec, queueLength: queue.length });`

### 5.2 Flush attempts (status + next retry)

- **Where:** `public/assets/core.js`, inside `processOutbox()`:
  - On **non-OK response:** after `throw new Error(...)` we’re in catch; log there (or in else branch before throw) with status and next retry delay.
  - In **catch block:** we have `err.message` (includes status) and fixed delay 5000.
- **Log (in catch, after attempts++):**  
  `console.log('[OPSMANTIK_DEBUG] flush', { status: err.message, attempts: currentEnvelope.attempts, nextRetryMs: 5000 });`
- **Log (in else branch, before throw):**  
  `console.log('[OPSMANTIK_DEBUG] flush non-OK', { status: response.status, nextRetryMs: 5000 });`  
  (So we have status even when we throw.)

### 5.3 Tracker init (and duplicate check)

- **Where:**  
  - On successful init: `public/assets/core.js`, after `console.log('[OPSMANTIK] ✅ Tracker initializing for site:', siteId);` (after line 74).  
  - On skip: already `console.warn('[OPSMANTIK] Tracker already initialized, skipping...');` at 9–11.
- **Log (once per init path):**  
  `console.log('[OPSMANTIK_DEBUG] tracker init', { siteId: siteId, ts: Date.now() });`  
  (So we can count inits per page load.)
- **Log (on skip):**  
  `console.log('[OPSMANTIK_DEBUG] tracker init skipped (duplicate)', { ts: Date.now() });`

**Implemented:** All above logs are in `public/assets/core.js`, gated by `localStorage.getItem('opsmantik_debug') === '1'`. Enable with `localStorage.setItem('opsmantik_debug', '1')` on poyrazantika.com (or any site) and reload.

---

## 6) Root Cause Summary & Fix Targets

### 6.1 Root Cause Summary (10 lines)

1. Server rate limit is **100 requests per 60 seconds per clientId** (IP + UA), not per site.
2. Each tab sends **~1 heartbeat/min** plus **1 view on load** and occasional interactions; steady state **~1–2 req/min per tab**.
3. **Poyraz Antika** likely has higher traffic per IP (or same IP with more tabs) than other sites, so that IP’s bucket hits 100/min.
4. Once the first **429** is returned, the client **retries every 5 seconds** with no backoff; the same envelope is retried and new heartbeats/views keep enqueueing.
5. **Retry storm:** 12 retries/min for failed envelope + normal traffic pushes the same IP over 100/min repeatedly.
6. **Multi-site collision:** If the same user (IP+UA) visits multiple sites, all share one bucket; Poyraz Antika traffic can exhaust it for everyone on that IP.
7. **No per-site isolation:** One busy site (Poyraz Antika) can cause 429 for that IP even when other sites would be under limit.
8. Duplicate tracker init or many tabs on Poyraz Antika would increase requests per IP and make 429 more likely.
9. **Evidence:** Console shows repeated `[TankTracker] Network Fail - Retrying later: Server status: 429` and `POST .../api/sync 429 (Too Many Requests)`.
10. **Conclusion:** 429 on Poyraz Antika is explained by **IP+UA rate limit (100/min)** plus **high request volume and/or retry storm** from that site’s traffic; other sites don’t hit the limit because they have lower volume per IP or different IP mix.

### 6.2 Fix Targets (no implementation here)

| Fix | Expected impact |
|-----|------------------|
| **Client backoff on 429** | Reduce retry rate (e.g. 30–60s or Retry-After); stop retry storm and bring req/min under 100 for that IP. |
| **Batch events** | Fewer requests per minute for same events (e.g. 1 request per N events); lowers peak req/min per tab. |
| **Per-site rate limit** | Isolate Poyraz Antika from other sites; one site’s traffic no longer exhausts shared bucket; fairer and more predictable. |

---

**Audit complete. No behavior changes beyond optional DEBUG logs.**
