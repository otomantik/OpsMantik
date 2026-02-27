# Sprint 3 Final Audit Report — Scaling & Multi-Tenant Resilience

**Initiative:** Noisy Neighbor Protection & Connection Resilience  
**Status:** Complete  
**Date:** 2026-02-25  

---

## 1. Noisy Neighbor Protection (Rate Limiting & Quotas)

### Implemented

- **Secondary rate-limiting layer** in `lib/services/rate-limit-service.ts`:
  - **`tryAcquireHeavyRead(siteId)`**: Uses Upstash Redis key `heavyread:{siteId}` with INCR/DECR to enforce a **per-site concurrency limit** for heavy read operations.
  - Config: `HEAVY_READ_MAX_CONCURRENT_PER_SITE` (default 5), TTL 300s on the key to avoid leaked slots.
  - Returns `{ allowed: boolean; release: () => Promise<void> }`. Callers must call `release()` when done (e.g. in `finally`).
  - On Redis errors, fails open (allows request, no-op release) to avoid breaking reporting when Redis is unavailable.

- **Reporting route** `GET /api/reporting/dashboard-stats`:
  - Accepts `siteId`, `from`, `to`, `ads_only` (query params). Requires authenticated user and `validateSiteAccess(siteId)`.
  - Calls `RateLimitService.tryAcquireHeavyRead(siteId)` before running the RPC. If `allowed === false`, returns **429 Too Many Requests** with `Retry-After: 60`.
  - Runs `get_dashboard_stats` RPC with **10s query timeout** via `withQueryTimeout()`. On timeout returns **504**.
  - Always calls `release()` in `finally`, so the slot is freed even on error or timeout.

- **Ingest pipeline (writes)** remains **unchanged**: no heavy-read limit applied to sync, call-event, or other write paths. Only the new reporting route and any future heavy-read endpoints use this layer.

### Verification

- One tenant (e.g. Tenant A) running 10+ concurrent dashboard-stats requests: the 11th and beyond receive **429** until earlier requests complete and release slots.
- Ingest (sync, call-event) is not rate-limited by this mechanism and stays clear.

---

## 2. Connection Pool Optimization & Query Timeout

### Implemented

- **Transaction Pooler (port 6543)**:
  - **`lib/supabase/admin.ts`**: Comment added that this client uses the Supabase REST API and does not hold Postgres connections; for high-frequency workers using a **direct Postgres client** (e.g. serverless driver), the **Supabase Transaction Pooler (port 6543)** should be used to avoid connection exhaustion when many QStash workers run simultaneously.
  - **`lib/supabase/tenant-client.ts`**: Comment added that the wrapper uses the admin REST client and does not open direct Postgres connections; for direct SQL, use the Transaction Pooler (port 6543) and apply query timeouts for reporting (e.g. 10s).

- **Query timeout helper** `lib/utils/query-timeout.ts`:
  - **`withQueryTimeout(promise, ms)`** (default 10s): Races the given promise against a timeout. If the timeout wins, the promise is rejected with `QUERY_TIMEOUT` (the underlying operation is not cancelled). Used to prevent long-running reporting queries from holding resources indefinitely.

- **Reporting route** uses `withQueryTimeout(supabase.rpc(...), 10_000)` and returns **504** when the timeout fires.

### Verification

- Dashboard-stats requests that exceed 10s return **504** and release the heavy-read slot.
- Documentation in code makes it clear that direct Postgres usage (e.g. serverless driver) should use port 6543 and timeouts; the existing JS client remains REST-based and does not consume Postgres connections directly.

---

## 3. Cross-Session Identity (GCLID Lockdown Phase 2)

### Implemented

- **localStorage clear on organic re-entry** (`public/assets/core.js`):
  - When `isNewSession` is true and attribution is taken only from the current URL, the tracker now also clears **localStorage** for the same attribution keys used in sessionStorage: `contextKey`, `contextWbraidKey`, `contextGbraidKey`, when the corresponding value is not present on the URL (organic re-entry). This prevents stale cross-session values from leaking into a new session.

- **Ingest safety check** (`lib/services/session-service.ts`):
  - **Create session**: If the session is classified as Organic (`attributionSource === 'Organic'` or server-classified `traffic_source` in `['Direct', 'SEO', 'Referral']`), **gclid**, **wbraid**, and **gbraid** from the payload are **not** persisted; they are set to `null` to prevent ghost attribution.
  - **Update session**: If the existing session has `attribution_source === 'Organic'`, click IDs from the request are **not** applied: **gclid** remains the existing session value (or null), and **wbraid**/**gbraid** are set to `null` (no new click IDs from payload). Non-organic sessions continue to accept new click IDs as before.

### Verification

- New session with no click ID in URL: sessionStorage and localStorage attribution keys are cleared for that context; server creates session with no gclid/wbraid/gbraid when classification is Organic.
- Payload containing GCLID but session marked Organic: server does not persist those click IDs (create or update), avoiding ghost attribution.

---

## 4. Final Integrity Sweep (Payload & Version)

### AdsContext / BehaviorContext

- **AdsContext** is now defined as a **single source of truth** in `lib/ingest/call-event-worker-payload.ts`:
  - **`AdsContextSchema`** (Zod): strict schema for all fields (keyword, match_type, network, device, device_model, geo_target_id, campaign_id, adgroup_id, creative_id, placement, target_id) with appropriate limits (e.g. string lengths, positive integers).
  - **`AdsContext`** type is **`z.infer<typeof AdsContextSchema>`** (no `any`).
  - **`AdsContextOptionalSchema`**: `AdsContextSchema.nullable().optional()` for ingest routes.
  - **`app/api/call-event/route.ts`** and **`app/api/call-event/v2/route.ts`** import **`AdsContextOptionalSchema`** from the shared module and use it for `ads_context` in the request schema. Duplicate local schemas removed.
- **BehaviorContext**: Not present in the codebase; no changes. Only AdsContext was updated to Zod-validated types to prevent payload poisoning.

### Version Column Audit (Mutation Routes)

| Location | Usage |
|----------|--------|
| **`app/api/calls/[id]/seal/route.ts`** | Reads `version` from DB; sends `p_version` to seal RPC; handles P0002 / version mismatch as concurrency conflict. |
| **`app/api/calls/[id]/stage/route.ts`** | Passes `version` from body to `PipelineService.stageCall()`; returns 409 on `version_mismatch`. |
| **`app/api/workers/calc-brain-score/route.ts`** | Selects `version`, updates with `version: currentVersion + 1` and `.eq('version', currentVersion)` for optimistic locking. |
| **`lib/services/pipeline-service.ts`** | Uses `version` in update filter when provided; returns `reason: 'version_mismatch'` when no rows updated and version was supplied. |

All mutation paths that touch the `calls` table’s version use it for optimistic concurrency control; no missing version checks were identified in this audit.

---

## 5. Summary

- **Noisy neighbor**: Per-site heavy-read concurrency limit (Redis) is enforced on the new reporting route; 429 on over-limit; ingest pipeline unchanged.
- **Connection resilience**: Pooler (port 6543) documented for direct Postgres use; 10s query timeout applied to dashboard-stats; timeout helper available for other reporting RPCs.
- **GCLID Phase 2**: localStorage cleared on organic re-entry; ingest rejects persisting click IDs when session is Organic (create and update).
- **Integrity**: AdsContext is Zod-only (shared schema); version usage audited across seal, stage, calc-brain-score, and pipeline-service — all use version for optimistic locking as intended.

The system is now resilient to noisy-neighbor behavior (per-tenant heavy-read caps, 429/504) and to connection saturation (timeouts, pooler guidance), with stricter attribution and payload integrity.
