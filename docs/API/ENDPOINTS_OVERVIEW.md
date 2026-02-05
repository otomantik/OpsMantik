# OpsMantik API — Endpoints Overview (Source of Truth)

**Last updated:** 2026-02-05  
**Scope:** HTTP endpoints implemented under `app/api/**/route.ts` (Next.js App Router)

> Note: There is also `docs/API/ALL_URLS_ENDPOINTS.md` (older, may drift). This file is intended to be the accurate engineering reference.

---

## Conventions

- **Auth types**
  - **Cookie session**: standard dashboard requests using Supabase auth cookies.
  - **Bearer token**: `Authorization: Bearer <access_token>` (used by smoke tests in some endpoints).
  - **API key**: `x-api-key` header (OCI pull strategy).
- **Site access gate**
  - Many endpoints check site access using `validateSiteAccess()` (owner/admin/site member).
- **CORS / Public ingest**
  - Tracking endpoints enforce a fail-closed CORS policy via `ALLOWED_ORIGINS`.
- **Time windows**
  - Some exports use TRT day windows (`getTodayTrtUtcRange()`).

---

## Tracking / Ingest

### `POST /api/sync`
**Purpose:** Main tracking ingestion endpoint (fast response; offloads processing).  
**Auth:** None (public), **CORS restricted**.  
**Rate limit:** 100/min per client (`RateLimitService`).  
**Behavior:**
- Validates origin, rate limits.
- Accepts compressed payload (`s`, `u`/`url`, `sid`, `ec`, `ea`, `meta`, `r`, …).
- Offloads to QStash (`/api/sync/worker`) and returns quickly.
**Also:**
- `OPTIONS /api/sync`: CORS preflight.
- `GET /api/sync?diag=1`: geo header diagnostic (returns chosen geo + headers present). Otherwise `405`.

### `POST /api/sync/worker`
**Purpose:** Background worker processing (sessions/events/intents/stats).  
**Auth:** QStash signature verification (`verifySignatureAppRouter`). Not for browsers.  
**Behavior highlights:**
- Idempotency ledger (`processed_signals`) for safe retries.
- Creates/updates session, writes events, generates intents, updates realtime stats overlay.
- Writes DLQ rows on non-retryable failures.

### `POST /api/call-event`
**Purpose:** Bridge for phone/whatsapp click → match to recent session (fingerprint).  
**Auth:** None (public), **CORS restricted**.  
**Rate limit:** 50/min per client.  
**Behavior:** Finds recent fingerprint events (30m), matches session, scores, inserts into `calls`.
**Also:** `OPTIONS /api/call-event` for CORS preflight.

---

## Qualification / Deals (Queue actions)

### `POST /api/intents/[id]/status`
**Purpose:** Update a call/intent status (supports undo/restore/cancel flows).  
**Auth:** Cookie session required.  
**Access:** Site access via `validateSiteAccess(site_id, user_id, supabase)` (owner/admin/member).  
**Body:** `{ status: 'intent' | 'junk' | 'confirmed' | 'qualified' | 'real' | 'suspicious' | 'cancelled', lead_score?: number | null }`  
**Side effects:**
- Sets `confirmed_at` when status becomes confirmed/qualified/real.
- Sets `cancelled_at` when status becomes cancelled.
- Clears `confirmed_at/cancelled_at` when moving back to `intent/junk/...`.

### `POST /api/calls/[id]/seal`
**Purpose:** “Seal deal” (Casino Kasa) — confirm a call with optional price and lead score.  
**Auth:** Cookie session **or** `Authorization: Bearer <token>` (smoke tests).  
**Access:** `validateSiteAccess` gate.  
**Body:** `{ sale_amount: number|null, currency: string, lead_score?: number }` (lead_score 0–100).  
**Side effects:** Sets `status='confirmed'`, `confirmed_at`, `confirmed_by`, `oci_status='sealed'`.

---

## OCI (Offline Conversions Export)

### `GET /api/oci/export?siteId=<uuid>`
**Purpose:** Download a CSV for offline conversion upload (today TRT window).  
**Auth:** Cookie session required + site access (owner/member/admin via RLS check on `sites`).  
**Output:** `text/csv; charset=utf-8` attachment.  
**Side effects:** Marks exported calls as `oci_status='uploaded'` (best-effort).

### `GET /api/oci/export-batch?siteId=<uuid>`
**Purpose:** OCI “pull strategy” for Google Ads Script — returns JSON batch.  
**Auth:** API key only (`x-api-key` must match `OCI_API_KEY`).  
**Output:** JSON array of `{ gclid, gbraid, wbraid, conversion_name, conversion_time, value, currency }`.  
**Side effects:** Marks exported calls as `oci_status='uploaded'` (best-effort).

---

## Sites / Admin

### `POST /api/sites/create`
**Purpose:** Create a new site (generates unique `public_id`).  
**Auth:** Cookie session required.  
**Body:** `{ name: string, domain: string }`

### `GET /api/sites/[id]/status`
**Purpose:** Returns site “receiving events” health (last event/session info).  
**Auth:** Cookie session required.  
**Access:** Owner/member/admin.

### `POST /api/customers/invite`
**Purpose:** Invite a customer to a site (`site_members`), create user if needed.  
**Auth:** Cookie session required.  
**Access:** Site owner or admin.  
**Body:** `{ email: string, site_id: string, role?: 'viewer'|'editor'|'owner' }`  
**Notes:** Rate limited + writes audit (`customer_invite_audit`).

### `POST /api/customers/invite-audit`
**Purpose:** Fetch invite audit logs (RPC wrapper).  
**Auth:** Cookie session required.
**Body:** `{ siteId: string, limit?: number, offset?: number, emailQuery?: string|null, outcome?: string|null }`

### `POST /api/create-test-site`
**Purpose:** Convenience endpoint to create a localhost test site for the current user.  
**Auth:** Cookie session required.

---

## Automation / Jobs

### `POST /api/jobs/auto-approve`
**Purpose:** Auto-approve (auto-seal) low-risk stale intents after 24h.  
**Auth:** Cookie session required + site access.  
**Body:** `{ siteId: string, minAgeHours?: number, limit?: number }`  
**Notes:** Intended to be called by a cron (see `docs/OPS/AUTO_APPROVE_CRON.md`).

---

## Stats / Monitoring

### `GET /api/stats/realtime?siteId=<uuid|public_id>`
**Purpose:** Redis overlay realtime stats (today).  
**Auth:** Cookie session required + site access.  
**Notes:** Origin checked (falls back to `referer`/same origin for GET).

### `GET /api/stats/reconcile?siteId=<public_id>&date=<YYYY-MM-DD>`
**Purpose:** Admin-only drift reconciliation (Redis vs DB counts).  
**Auth:** Admin only.

### `GET /api/health`
**Purpose:** Lightweight health check + optional DB check with timeout.  
**Auth:** None.

---

## DLQ (Dead Letter Queue) — Admin Ops

### `GET /api/sync/dlq/list?limit=&offset=&siteDbId=`
**Purpose:** List DLQ items (`sync_dlq`).  
**Auth:** Admin only.

### `POST /api/sync/dlq/replay?id=<dlqId>`
**Purpose:** Re-publish a DLQ payload back to QStash worker + audit replay.  
**Auth:** Admin only.

### `GET /api/sync/dlq/audit?limit=&offset=&dlqId=`
**Purpose:** List DLQ replay audit rows (`sync_dlq_replay_audit`).  
**Auth:** Admin only.

---

## Dev / Test / Examples (Non-production or for observability)

### `POST /api/debug/realtime-signal`
**Purpose:** Dev-only synthetic inserts to test Supabase realtime wiring.  
**Auth:** Cookie session required + site access.  
**Guardrails:** Disabled in production (`404`).

### `GET /api/watchtower/test-throw`
**Purpose:** Smoke-test endpoint that throws when `WATCHTOWER_TEST_THROW=1`.  
**Auth:** None.

### `GET /api/sentry-example-api`
**Purpose:** Deliberately throws to test Sentry pipeline.  
**Auth:** None.

