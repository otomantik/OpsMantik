# P0 Retry Backoff — Verification Steps

This doc covers **Step-1** (init de-dupe + visibility-aware heartbeat), **Step-2** (batch + throttle outbox), and **Step-3** (site-scoped rate limit + Retry-After). The **first 429 retry** is **30–60 seconds** by design (see “429 First Retry Timing Note” below).

---

## Rate limit: site-scoped (no cross-site collisions) (Step-3)

- **Key:** When the request body contains a valid **siteId** (`body.s` or, for batch, `events[0].s`), the rate limit key is **`${siteId}:${clientId}`** (clientId = IP + UA, first 64 chars of UA). When siteId is missing or invalid, the key falls back to **`clientId`** (same as before).
- **Effect:** Each site has its **own bucket** per client. So one busy site (e.g. Poyraz Antika) cannot exhaust the shared 100/60s limit for the same IP+UA; other sites keep their own 100/60s. This **prevents Poyraz from throttling other sites** on the same client.
- **Limit and window:** Unchanged: **100 requests per 60 seconds** per key.
- **429 response:** Includes **`Retry-After`** (seconds), e.g. 60 or derived from the current window reset. The header **`x-opsmantik-ratelimit: 1`** is still set.

---

## 429 First Retry Timing Note

- **Backoff formula (429):** `max(30000, 30000 * 2^attempts) + jitter` (jitter 0–3000 ms).
- Depending on **when** `attempts` is incremented relative to the delay calculation, the **first** retry may occur at **30–60 seconds** after the initial 429. For example, if the first failure uses `attempts === 0`, the delay is ≥30 s; the next run may see `attempts === 1` and thus a longer delay. This range is **expected and not a bug**.
- The **first retry will always be ≥ 30 seconds** after the 429. There is no 5-second retry for 429.
- This behavior is **intentional** to avoid retry storms and to keep the rate of retries below the server’s limit.

---

## Reproduce 429 and confirm retries slow down (≥30s, no spam)

1. **Trigger 429:** Use a site that hits rate limit (e.g. many tabs on same origin, or temporary server-side 429 mock). Alternatively, from one IP send >100 POSTs to `/api/sync` within 1 minute so the server returns 429.

2. **Enable DEBUG:** In browser console on the site:
   ```js
   localStorage.setItem('opsmantik_debug', '1');
   ```
   Reload so the tracker uses the new backoff logic.

3. **Observe logs:** After the first 429 you should see:
   - `[TankTracker] Network Fail - Retrying later: Server status: 429`
   - `[OPSMANTIK_DEBUG] backoff` with `status: 429`, `attempts: 1`, `delayMs` ≥ 30000 (e.g. 30000–33000), `nextAttemptAt` in the future.

4. **Confirm no 5s spam:** In Network tab, the next POST to `/api/sync` for the same envelope should occur **no sooner than ~30 seconds** after the 429. Subsequent 429s should double the wait (e.g. ~60s, ~120s) up to a cap (~10 min). You should **not** see a POST every 5 seconds.

5. **Optional:** Clear queue and force one envelope, then repeatedly get 429: verify delayMs increases (e.g. 30s → 60s → 120s) and caps around 10 min.

---

## Confirm non-429 4xx does not retry

1. **Simulate 400/404/4xx:** Use a stub or proxy so `/api/sync` returns 400 or 404 (e.g. invalid payload or not-found). Or temporarily change server to return 400 for a test site.

2. **Observe:** After one POST that returns 4xx (not 429):
   - The envelope should be **dropped** (removed from queue).
   - **No** `[TankTracker] Network Fail - Retrying later` for that envelope.
   - **No** further POSTs for that same envelope; `processOutbox` should move to the next item or idle.

3. **DEBUG:** With `opsmantik_debug=1`, you should not see `[OPSMANTIK_DEBUG] backoff` for 4xx (only for 429 or 5xx/network). The envelope is shifted off without scheduling a retry.

---

## Dead-letter (4xx not 429) — manual verification

1. **Simulate 400 or 404:** Use a stub, proxy, or temporary server change so `/api/sync` returns 400 or 404 for a test request.

2. **Confirm:**
   - The envelope is **removed** from the active queue (no further POSTs for it).
   - **No retry** occurs for that envelope.
   - **localStorage** key `opsmantik_dead_letters` contains a **new entry** with `ts`, `status`, `ec`, `ea`, `attempts`. Only the **last 20** entries are retained (oldest dropped when length > 20).

3. **With DEBUG enabled:** Run `localStorage.setItem('opsmantik_debug','1')`, then trigger a 4xx again. The **console** should show:
   ```text
   [OPSMANTIK_DEBUG] dead-letter { status: 400, ec: '...', ea: '...' }
   ```
   (or 404, etc.). Without DEBUG, storage still runs; only the log is gated.

4. **Confirm unchanged behavior:**
   - **429:** Still uses backoff (≥30s), no change.
   - **5xx / network:** Still retried with backoff, no change.
   - No new request storm: dead-letter is write-only and does not trigger sends.

---

## P0-2: Heartbeat visibility + Init de-dupe verification

### Single init

1. **Load page once:** Open a page that loads the tracker (e.g. `core.js` or `ux-core.js` with a valid `data-ops-site-id`).
2. **Confirm:** A **single** init log appears once: `[OPSMANTIK] ✅ Tracker initializing for site: <id>`. No duplicate init message.

### Double-load (WP / Elementor)

1. **Simulate double-load:** In a setup where the tracker script can run twice (e.g. WordPress/Elementor with two widgets, or manually inject a second `<script src=".../core.js" data-ops-site-id="...">` after the first).
2. **Confirm:** The **second** init is skipped: no second set of autotracking listeners, no second heartbeat interval, no second outbox processor.
3. **With DEBUG:** Set `localStorage.setItem('opsmantik_debug', '1')`, reload so both “loads” run. Console should show **once** the init log, and on second load: `[OPSMANTIK_DEBUG] tracker init skipped (duplicate)` with a `ts` value. No second `[OPSMANTIK] Auto-tracking initialized`.

### Heartbeat when hidden

1. **Load page** with the tracker and wait for first heartbeat (or confirm one POST to `/api/sync` with `ea: heartbeat` or similar).
2. **Switch tab (or minimize):** Move to another tab or minimize the window so `document.hidden === true`. Wait **longer than `heartbeatInterval`** (e.g. > 60 seconds).
3. **Confirm:** In Network tab, **no** new heartbeat POSTs to `/api/sync` while the tab is hidden. Heartbeats run only when the document is visible.

### Heartbeat on return to tab

1. **Return to the tab** so the page becomes visible again.
2. **Confirm:** **One** heartbeat POST happens **soon** after becoming visible (visibilitychange fires, one immediate heartbeat is sent).
3. **Then:** Heartbeats continue at the normal interval (`heartbeatInterval`, e.g. every 60 s) while the tab stays visible. No duplicate interval; only one heartbeat per interval when visible.

---

## Unit test (automated)

```bash
npx node --import tsx --test tests/unit/tracker-transport-backoff.test.ts
```

- Asserts `getRetryDelayMs(429, 0).delayMs` in [30s, 33s] and `retry === true`.
- Asserts delays increase with attempt count and cap for 429.
- Asserts `getRetryDelayMs(400, 0).retry === false` and `getRetryDelayMs(404, 5).retry === false`.
- Asserts 5xx and undefined (network) get min 5s and cap 2 min.

---

## Batch + throttle expected behavior

The outbox uses **Tag-Manager-grade batching and throttling** (in both `lib/tracker/transport.js` and `public/assets/core.js`).

### Batching

- **Batch size:** Up to **20 envelopes** per request (`MAX_BATCH = 20`). Only envelopes with `nextAttemptAt <= now` are included.
- **Payload cap:** Request body is capped at ~**50 KB** (`PAYLOAD_CAP_BYTES`). Batches stop adding envelopes when the next would exceed this size.
- **Request body:**
  - **Batch mode (multiple envelopes):** `POST /api/sync` with body `{ "events": [ ...payloads ] }` (array of envelope payloads).
  - **Single-envelope mode:** Same as before: body is a single JSON payload (one event). Used when `batchSupported === false` or when only one envelope is ready.

### Throttling

- **Min flush interval:** **2 seconds** per tab (`MIN_FLUSH_INTERVAL_MS = 2000`). If a flush is attempted within 2 s of the last flush, the next run is scheduled for `lastFlushAt + 2000 - now` and no request is sent.
- **Effect:** Rapid events (e.g. many clicks) do not cause one request per event; they are batched and sent at most once every 2 s per tab.

### Feature-detect batch support

- If the server responds with **400** or **415**, or with a body **`error === 'batch_not_supported'`** or **`code === 'BATCH_NOT_SUPPORTED'`**, to a batch request:
  - The client sets **`batchSupported = false`** and **`batchRetryAt = Date.now() + 5*60*1000`** (in-memory only).
  - Subsequent flushes send **one envelope per request** until **`now >= batchRetryAt`**, then the client allows batch again (**`batchSupported = true`**, **`batchRetryAt`** cleared).
- **batchRetryAt behavior:** The fallback to single-envelope is **temporary**. After **5 minutes** the client automatically re-tries batch; if the server has been updated to accept batch, batching resumes without a reload.
- This keeps **backward compatibility** when `/api/sync` does not yet accept `{ events: [...] }`.

### nextAttemptAt and backoff

- If the **head** of the queue has `nextAttemptAt` in the future, no send occurs; `processOutbox` is scheduled for that time (unchanged).
- **On success:** Exactly the envelopes that were sent are removed from the front of the queue (in order).
- **On 429/5xx (or network error):** Backoff is applied only to the **first** envelope in that batch; the rest remain queued for the next flush.

### DEBUG (opsmantik_debug=1)

- Per flush the client logs: **`sentCount`**, **`remainingQueueLength`**, **`batchSupported`**, **`throttled`** (boolean). When throttled, a separate “throttle scheduled” log is emitted.

---

## How to verify req/min drops and events/req increases

1. **Enable batch and throttle:** Use a build that includes the batch/throttle outbox (current `transport.js` and `core.js`). Ensure the server accepts batch requests (or use a stub that returns 2xx for `{ events: [...] }`).

2. **Generate many events quickly:** On a page with the tracker, trigger many events in a short time (e.g. 100 clicks on a tracked element, or call `sendEvent(...)` in a loop from the console). Do **not** wait 2 s between each.

3. **Observe Network tab:**
   - **Requests per minute:** Should stay **low** because of the 2 s throttle. You should see at most ~30 requests per minute per tab (one every 2 s), not 100 requests.
   - **Events per request:** When the server accepts batch, each POST body should contain **multiple events** (e.g. `events: [ ... ]` with length > 1). So **events per request** should be **> 1** when `batchSupported === true`.

4. **With DEBUG:** Set `localStorage.setItem('opsmantik_debug', '1')` and reload. After flushes you should see logs like:
   - `[OPSMANTIK_DEBUG] flush` with `sentCount: 5`, `remainingQueueLength: 95`, `batchSupported: true`, `throttled: false`.
   - If you trigger another flush within 2 s: `[OPSMANTIK_DEBUG] throttle scheduled` and no request until the interval has passed.

5. **Fallback (batch not supported):** If the server returns 400/415 for a batch request, the next flush should send **one envelope per request** and DEBUG should show `batchSupported: false`. Requests per minute can increase (up to one per envelope per 2 s), but the client should not crash and should eventually drain the queue.

---

## Manual test: 100 events quickly (throttle + batch)

1. **Setup:** Load a page that uses the tracker (`core.js` or equivalent) with a valid `data-ops-site-id`. Open DevTools → Network, filter by “sync” or your API host. Optionally set `localStorage.setItem('opsmantik_debug', '1')` and reload.

2. **Generate 100 events:** In the console, run something like:
   ```js
   for (var i = 0; i < 100; i++) {
     window.opmantik && window.opmantik.send('test', 'click', 'batch-test-' + i, 0);
   }
   ```
   (The tracker exposes `window.opmantik.send(category, action, label, value, metadata)`.) Alternatively, simulate 100 rapid clicks on a tracked CTA.

3. **Confirm throttle:** In Network tab, count POSTs to `/api/sync` over the next 1–2 minutes. You should see **at most ~30 requests per minute** (one every 2 s), not 100. So **requests per minute stays low**.

4. **Confirm batching (when server supports batch):** Inspect the **request payload** of the first few POSTs. If the server accepts batch, the body should be `{"events":[...]}` with **more than one** item in the array. So **events per request > 1** when batch is supported.

5. **Optional:** If the server does **not** support batch (returns 400/415 for `{ events: [...] }`), after the first such response the client should fall back to one envelope per request; the queue should still drain, with at most one request every 2 s per envelope.
