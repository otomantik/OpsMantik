# Phase 1 — SECTOR ALPHA & BRAVO: Status Report (English)

**Date:** 2026-01-29  
**Purpose:** Status and analysis for SECTOR ALPHA (Database) and SECTOR BRAVO (Tank Tracker).  
**Audience:** Analysis / review.

---

## 1. Executive Summary

| Sector | Scope | Status | Notes |
|--------|--------|--------|--------|
| **ALPHA** | Database upgrade (AI columns, events.site_id, processed_signals, auto-partitions) | **Deployed** | Migration applied; pg_cron not enabled — partition maintenance manual or via Edge Function. |
| **BRAVO** | Tracker refactor (Store & Forward / Tank Tracker) | **Deployed & verified** | ux-core.js refactored; smoke tests pass (static + events + offline/online with local page). |

---

## 2. SECTOR ALPHA — Database

### 2.1 Delivered

- **Sessions:** `ai_score`, `ai_summary`, `ai_tags`, `user_journey_path` added for future “intelligence” / AI use.
- **Events:** Nullable `site_id` (FK to sites) + index `idx_events_site_id` for Realtime filtering. API populates `site_id` on every event insert.
- **Processed signals (ledger):** Table `processed_signals` (event_id PK, received_at, site_id, status) for idempotent ingestion / deduplication; RLS on, no policies (API-only).
- **Auto-partitioning:** Function `create_next_month_partitions()` creates `sessions_YYYY_MM` and `events_YYYY_MM` for the next month. **pg_cron not enabled** — migration logs: “pg_cron not enabled. Run create_next_month_partitions() manually or via a Scheduled Edge Function.”

### 2.2 Verification

- **Migration:** `supabase db push` completed; NOTICE about pg_cron only (no failure).
- **events.site_id:** Supabase events table shows recent rows with `site_id` populated (e.g. 10/10 in last 10 events).
- **Smoke:** `npm run smoke:tank-tracker-events` (or `smoke:tank-tracker-all`) queries Supabase for last 5 min event count and last 10 events; confirms data flow and site_id presence.

### 2.3 Open / Risks

- **Partition maintenance:** Without pg_cron, next month’s partitions must be created manually or by a scheduled job (e.g. Edge Function on the 1st). If not done before the 1st, writes to sessions/events can fail with “no partition” until `create_next_month_partitions()` is run.
- **processed_signals:** Backend (Sync API) is not yet using this table for idempotency; ledger is in place for future “Store & Forward” server-side deduplication.

---

## 3. SECTOR BRAVO — Tank Tracker (Store & Forward)

### 3.1 Delivered

- **Outbox model:** All events go to localStorage key `opsmantik_outbox_v2` (envelope: id, ts, payload, attempts). Max 100 items; trim to 80 when over.
- **Send path:** No blind sendBeacon. Main path: `addToOutbox(payload)` → `processOutbox()` (fetch + 5s timeout, response.ok check). Success → remove from queue; failure → increment attempts, save queue, retry after 5s. Drop when attempts > 10 and age > 24h.
- **Last gasp:** `beforeunload` sends first queue item via sendBeacon (best-effort; no response read).
- **Recovery:** On load and on `online` event, `processOutbox()` runs so queued events are sent when back online.

### 3.2 Verification

- **Static proof:** `npm run smoke:tank-tracker` — checks ux-core.js for required patterns (opsmantik_outbox_v2, getQueue, saveQueue, addToOutbox, processOutbox, response.ok, TankTracker log, online listener, beforeunload+sendBeacon). **Result:** 9/9 passed.
- **Events proof:** `npm run smoke:tank-tracker-events` — queries Supabase for last 5 min events and last 10 events (with site_id). **Result:** PASS (events present, site_id populated).
- **Offline/Online proof:** `npm run smoke:tank-tracker-offline` with **USE_LOCAL_TRACKER_PAGE=1** — serves `public/smoke-tracker-test.html` + `public/ux-core.js` locally; goes offline, triggers `opmantik.send()`, checks outbox_v2 (and legacy evtq_v1); goes online, checks outbox. **Result:** PASS (Store: outbox_v2 has items after offline; Forward: N/A for local page because API is not on localhost, which is documented).

### 3.3 Live site vs local

- **Live site (e.g. poyrazantika.com):** If the site still serves the **old** tracker (sendBeacon-first, old queue key), offline event may not be written to any queue (sendBeacon can “succeed” without network). Then both outbox_v2 and legacy queue stay 0 → Offline/Online proof fails on live URL.
- **Local page (USE_LOCAL_TRACKER_PAGE=1):** Uses project’s `public/ux-core.js` (Tank Tracker). Offline → send → outbox_v2 gets the event → Store passes. Forward is N/A (no /api/sync on local server). **User confirmed test passed** with this mode.

---

## 4. Test Commands Summary

| Command | What it does |
|---------|----------------|
| `npm run smoke:tank-tracker-all` | Runs static proof + events proof + (if URL or USE_LOCAL_TRACKER_PAGE set) Offline/Online proof. |
| `npm run smoke:tank-tracker` | Static proof only (ux-core.js patterns). |
| `npm run smoke:tank-tracker-events` | Supabase events proof (last 5 min count, last 10 events, site_id). |
| `npm run smoke:tank-tracker-offline` | Playwright Offline/Online proof. Use `USE_LOCAL_TRACKER_PAGE=1` in .env.local to test with local Tank Tracker. |

---

## 5. Recommendations for Analysis

1. **Partition maintenance:** Decide and implement either pg_cron (if available on the plan) or a monthly scheduled Edge Function / cron job that runs `create_next_month_partitions()` before the 1st.
2. **Live site rollout:** Deploy the new ux-core.js (Tank Tracker) to production sites (e.g. poyrazantika.com) so that Offline/Online proof passes against the live URL and users get Store & Forward in production.
3. **processed_signals:** When ready, wire Sync API to check/insert processed_signals (e.g. by event id or idempotency key) so duplicate retries do not double-count.
4. **AI columns:** Sessions now have ai_score, ai_summary, ai_tags, user_journey_path; no backend or UI yet. Plan where and when to populate these (e.g. post-processing or real-time pipeline).

---

## 6. Status: PASS

- **SECTOR ALPHA:** Migration applied; events.site_id populated; partition function present; pg_cron not active (manual/scheduled run required).
- **SECTOR BRAVO:** Tank Tracker refactor deployed; static and events smoke pass; Offline/Online smoke passes with USE_LOCAL_TRACKER_PAGE=1. Ready for production rollout of ux-core.js to live sites.
