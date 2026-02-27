# Hardness Map: Destructive Audit Report

**Operation Blackout** — Cynical systems investigation. No green lights; only RED (Single Point of Failure) and ORANGE (Unstable Under Stress).

---

## 1. Database Blackout (RPO)

**Scenario:** Supabase or connection pooler down 30s during 1000 events/sec peak.

### Current Flow
- **Sync route:** validateSite (Supabase) → rate limit (Redis) → QStash publish → on failure: fallback to `ingest_fallback_buffer` (Supabase).
- **Client outbox:** localStorage; retries 5xx with backoff; 4xx → dead-letter (no retry).

### Findings

| Issue | Severity | Evidence |
|-------|----------|----------|
| When QStash publish fails **and** fallback insert fails (Supabase down) → sync returns **202** with `x-opsmantik-degraded` | **RED** | `app/api/sync/route.ts:353-357` — `if (degraded > 0 && queued === 0)` returns 202. Client treats 202 as success, removes event from outbox. **Data lost.** |
| Fallback uses same Supabase as primary | **ORANGE** | `ingest_fallback_buffer` is Supabase. When Supabase is down, both QStash publish (external) and fallback fail. Fallback is same failure domain as validateSite. |
| Client retries 5xx, dead-letters 4xx | **OK** | `lib/tracker/transport.js` — getRetryDelayMs: 5xx retry=true; 4xx (except 429) retry=false. |
| Recover cron re-publishes fallback buffer | **OK** | `app/api/cron/recover/route.ts` — every 5 min, claims PENDING from `ingest_fallback_buffer`, publishes to QStash. |

### Fix (RED)
When **all** events in the batch fail both QStash and fallback → return **503** instead of 202. Client treats 503 as retryable; event stays in outbox.

---

## 2. Memory Leak / Client-Side Fragility

**Scenario:** Heavy React/Next.js hydration; localStorage full or blocked (Safari ITP, private mode).

### Current Flow
- Tracker: `opsmantik_outbox_v2` in localStorage; `getQueue`/`saveQueue` wrap in try/catch.
- `saveQueue` silently swallows errors; `getQueue` returns `[]` on error.

### Findings

| Issue | Severity | Evidence |
|-------|----------|----------|
| `saveQueue` fails silently; `getQueue` returns `[]` on throw | **RED** | `lib/tracker/transport.js:59-68` — `catch { return []; }` and `catch { }`. If localStorage is full/blocked, new events are never persisted. addToOutbox pushes to in-memory queue, saveQueue fails, next getQueue returns [] → **Silent death.** |
| Script is async; does not block hydration | **OK** | `ux-core.js` loads `core.js` with `s.async = true`. |
| Core.js complexity (SST, GCLID-first) is server-side | **OK** | GCLID-first and IP forwarding logic live in sync route and process-call-event; tracker payload is unchanged. |

### Fix (RED)
Add **sessionStorage fallback** when localStorage throws. If both fail, document as known limitation (private mode).

---

## 3. Zombie Worker (Stalled Processes)

**Scenario:** OCI worker starts processing; server killed (OOM/deploy) before completion → batch stuck in PROCESSING.

### Current Flow
- `offline_conversion_queue`: status QUEUED → PROCESSING (on claim) → COMPLETED/FAILED/RETRY.
- `recover_stuck_offline_conversion_jobs`: moves PROCESSING rows with `claimed_at` (or `updated_at`) older than N minutes to RETRY.
- Cron: `providers/recover-processing` every **30 min**; default `min_age_minutes` = **30**.

### Findings

| Issue | Severity | Evidence |
|-------|----------|----------|
| Stale job recovery exists | **OK** | `supabase/migrations/20260222100000_pr7_offline_conversion_perf.sql` — `recover_stuck_offline_conversion_jobs(p_min_age_minutes int DEFAULT 15)`. |
| Route uses 30 min default, not 15 | **ORANGE** | `app/api/cron/providers/recover-processing/route.ts:14` — `DEFAULT_MIN_AGE_MINUTES = 30`. RPC defaults to 15; route overrides. |
| Cron runs every 30 min | **OK** | `vercel.json`: `"schedule": "*/30 * * * *"`. |

### Fix (RED → ORANGE)
Change `DEFAULT_MIN_AGE_MINUTES` from 30 to **15** to match RPC default and reduce window for stuck jobs.

---

## 4. Validation Explosion (Schema Rigidness)

**Scenario:** Google Ads sends new ValueTrack param or unexpectedly long string; strict Zod schema rejects.

### Current Flow
- Ingest worker: `parseValidWorkerJobData` returns `{ kind: 'invalid' }` on failure (no throw).
- Worker returns `NextResponse.json({ ok: true })` for invalid payload → acks QStash, drops message.
- Call-event: `AdsContextOptionalSchema`; invalid payload fails at route before publish.

### Findings

| Issue | Severity | Evidence |
|-------|----------|----------|
| Worker does not throw on parse failure | **OK** | `app/api/workers/ingest/route.ts:72-73` — `if (parsed.kind !== 'ok') return NextResponse.json({ ok: true });` |
| Bad payload does not crash pipeline | **OK** | Single message acked and dropped; other messages in queue unaffected. |
| Call-event AdsContext: Zod at route | **OK** | Invalid ads_context fails before publish; no worker crash. |
| Worker catches all errors; retryable vs non-retryable | **OK** | `catch` block: `isRetryableError`; non-retryable → sync_dlq insert, return 200; retryable → return 500 (QStash retries). |

### Verdict
**Graceful degradation.** One bad payload cannot take down the pipeline.

---

## Summary: Hardness Map

| # | Scenario | RED | ORANGE | Status |
|---|----------|-----|--------|--------|
| 1 | Database Blackout | Sync returns 202 when both QStash+fallback fail → client drops event | Fallback same failure domain as primary | **Fix RED** |
| 2 | Client-Side | localStorage fail → silent death; no fallback | — | **Fix RED** |
| 3 | Zombie Worker | — | 30 min recovery window (should be 15) | **Fix ORANGE** |
| 4 | Validation Explosion | — | — | **OK** |

---

## Implemented Fixes

1. **Sync route** (`app/api/sync/route.ts`): When `degraded > 0 && queued === 0` (all events lost) → return **503** with `Retry-After: 60` instead of 202. Client retries; event stays in outbox.
2. **Recover-processing** (`app/api/cron/providers/recover-processing/route.ts`): `DEFAULT_MIN_AGE_MINUTES` → **15** (was 30). Stale PROCESSING jobs reset to RETRY after 15 min.
3. **Tracker transport** (`lib/tracker/transport.js`): `getStorage()` prefers localStorage, falls back to sessionStorage when localStorage throws. `saveQueue` tries sessionStorage when primary storage throws.
4. **Build pipeline** (`scripts/build-tracker.mjs`): `npm run tracker:build` bundles `lib/tracker` → `public/assets/core.js`. Do not edit core.js manually.
5. **Production bundles** (`public/assets/core.js`, `public/ux-core.js`): Both include getStorage + sessionStorage fallback. Cache version bumped to `?v=4`.
