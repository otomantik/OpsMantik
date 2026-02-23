# Conversation Layer — Race Conditions & Reliability Audit

**Role:** Distributed systems / DB race-condition auditor.  
**Goal:** Break the system logically under high concurrency, retries, double submits, cron/worker overlap, partial failures, out-of-order events.  
**Assumptions:** High concurrency, malicious authenticated users, network retries, double submits, cron overlap, worker overlap, partial failures, out-of-order events.

---

## A) Risk Table

| Scenario | Severity | Is Safe? | Why | Fix |
|----------|----------|----------|-----|-----|
| **1. Double confirm race** | — | **Yes** | RPC locks sale with `FOR UPDATE`; second caller blocks then sees status CONFIRMED and raises `sale_already_confirmed_or_canceled`. Insert uses `ON CONFLICT (sale_id) DO NOTHING`. One status transition, at most one queue row. | None. See timeline below. |
| **2. Confirm + late linking race** | P2 | **Mostly** | Backfill RPC uses COALESCE(new, existing) so it never overwrites non-null with null. Two resolves: both set conversation_id (last write wins), both call backfill → idempotent. Risk: if cron enqueued with NULL attribution and backfill runs after worker already claimed, worker may upload without gclid. | Document ordering: prefer backfill before or worker re-checks conversation after claim. Optional: backfill sets a “dirty” flag worker respects. |
| **3. Cron overlap** | — | **Yes** | Two crons both select CONFIRMED sales in window; both fetch existing queue sale_ids (possibly at different times). Inserts are per sale; UNIQUE(sale_id) forces one row. Second insert gets 23505 → code treats as skip and adds to existingSaleIds. No duplicate rows. Processed/enqueued counts are per-run and can overlap; no corruption. | None for correctness. Optional: use RPC or INSERT...ON CONFLICT DO NOTHING in DB to make “enqueue missing” atomic and avoid phantom read of existingSaleIds. |
| **4. Worker claim overlap** | — | **Yes** | `claim_offline_conversion_jobs` uses subquery with `FOR UPDATE SKIP LOCKED` then UPDATE...RETURNING. Same row cannot be locked by two workers; SKIP LOCKED prevents double-claim. | None. **Gap:** Worker crash leaves row in PROCESSING forever; no requeue/retry. | Add timeout/requeue: job in PROCESSING longer than N minutes → set back to QUEUED (or FAILED + retry policy). |
| **5. Conversation linking abuse** | P1 | **No** | `conversation_links` has no FK from `entity_id` to `calls`/`sessions`/`events`. Attacker with access to site A can link arbitrary UUIDs (e.g. call_id from site B). Data model allows orphan links and cross-entity references. | Add optional FK or app-level validation that entity_id exists in the relevant table for that entity_type and belongs to the same site (via session/call context). |
| **6. External ref idempotency** | P1 | **No** | (1) Two concurrent POSTs with same (site_id, external_ref): both may not see existing row → both insert → second gets 23505 → returns 500. (2) NULL external_ref: unique index is `WHERE external_ref IS NOT NULL`, so multiple DRAFT/CONFIRMED sales with NULL external_ref allowed → duplicate sales. (3) Slightly different strings ("ref" vs "ref ") create distinct rows; no normalization. | (1) On insert 23505, re-fetch by (site_id, external_ref), update and return 200. (2) Document that NULL external_ref disables upsert; consider business rule to reject or allow with explicit “no upsert” semantics. (3) Normalize: trim and optionally collapse whitespace before lookup/insert. |
| **7. Time window edge cases** | P2 | **Partial** | (1) occurred_at in future: cron includes it (gte); Google may reject future conversion_time. (2) occurred_at 10 days ago with hours=24: excluded → conversion missed. (3) Boundary: `since = now - 24h`, gte(occurred_at, since) → [since, +∞); inclusive left, no double-enqueue for same sale (UNIQUE sale_id). (4) Clock skew / TZ: server clock and client-provided occurred_at can diverge; no validation that occurred_at ≤ now. | (1) Optional: reject or cap occurred_at in API. (2) Document max window (168h); support manual backfill for outages. (3) Document boundary. (4) Consider server-side cap: min(occurred_at, now()) for conversion_time. |

---

### 1️⃣ Double confirm race — exact timeline

- **T1:** Req A: `confirm_sale_and_enqueue(sale_id)` → `SELECT ... FOR UPDATE` → **locks sale row** (status DRAFT).
- **T2:** Req B: `confirm_sale_and_enqueue(sale_id)` → `SELECT ... FOR UPDATE` → **blocks** (waiting for A’s lock).
- **T3:** A: checks status = DRAFT → UPDATE sale SET status = CONFIRMED → INSERT into queue ON CONFLICT DO NOTHING → RETURN → **commit** → lock released.
- **T4:** B: lock acquired → reads sale row → status = CONFIRMED → **raises** `sale_already_confirmed_or_canceled` → no UPDATE, no INSERT.
- **Result:** One transition DRAFT→CONFIRMED, one queue row. **Safe.** FOR UPDATE is enough; no stale state for B.

---

## B) State Machine Analysis

**Lifecycle (conceptual):**

```
Sale:     DRAFT ──(confirm_sale_and_enqueue)──► CONFIRMED
                    │
                    └──► Queue row created (if not exists) with status QUEUED

Queue:   QUEUED ──(claim_offline_conversion_jobs)──► PROCESSING
              ──(worker upload)──► COMPLETED / FAILED
```

**Verified:**

- **No illegal transitions:** Confirm RPC only allows DRAFT → CONFIRMED; claim only moves QUEUED → PROCESSING. Worker sets COMPLETED/FAILED. No other transitions defined.
- **No double transitions:** FOR UPDATE on sale prevents two confirms; UNIQUE(sale_id) + ON CONFLICT DO NOTHING prevents two queue rows; FOR UPDATE SKIP LOCKED prevents two claims of same row.
- **Stuck states:** PROCESSING with no worker completion (crash) → job stuck. No automatic rollback. **Recommendation:** Requeue or mark FAILED after N minutes and document retry policy.

**Double transitions:** Prevented at DB level (lock + unique + conflict handling).

---

## C) Concrete Fixes

### 1. Double confirm — already safe

- **SQL:** No change. RPC keeps `FOR UPDATE` and `ON CONFLICT (sale_id) DO NOTHING`.
- **API:** No change.

### 2. Confirm + late linking — optional hardening

- **SQL:** Backfill RPC already uses `COALESCE(v_primary_source->>'gclid', q.gclid)` etc., so idempotent and non-destructive.
- **API:** Resolve route: after updating sale.conversation_id, call backfill in same logical flow (already done). Optional: run backfill in a transaction with the sale update if both are done via RPC.
- **Locking:** Attribution RPC locks sale then updates queue by (sale_id, site_id); sufficient.

### 3. Cron overlap — already safe; optional atomic enqueue

- **SQL:** Optional: add RPC `enqueue_confirmed_sales_since(p_since timestamptz)` that inserts from sales with `INSERT...SELECT...ON CONFLICT (sale_id) DO NOTHING` so “select + insert” is atomic and no phantom read of “existing” set.
- **API:** Current 23505 handling is correct. If you add RPC, cron calls RPC instead of app-loop insert.
- **Constraint:** UNIQUE(sale_id) already prevents duplicate queue rows.

### 4. Worker claim — crash recovery

- **SQL:** No change for double-claim (already safe). Add either:
  - Scheduled job or worker step: `UPDATE offline_conversion_queue SET status = 'QUEUED', updated_at = now() WHERE status = 'PROCESSING' AND updated_at < now() - interval '15 minutes'` (and optionally cap attempt_count), or
  - A small “requeue stale” RPC with the same safety (service_role only, FOR UPDATE SKIP LOCKED on candidate rows).
- **API:** Worker: on success call API or RPC to set COMPLETED; on failure set FAILED and optionally increment attempt_count. Document retry/backoff and max attempts.

### 5. Conversation linking — cross-site / orphan entities

- **SQL:** Option A — add FKs (e.g. `entity_id` → `calls(id)` when `entity_type = 'call'`) only if all entity tables exist and are single-tenant by site. Option B — keep schema but enforce in app.
- **API:** Before inserting into `conversation_links`, validate that `entity_id` exists in the table for `entity_type` and belongs to the same site (e.g. call has site_id or is reachable via session/call to site). Reject 400 if invalid.
- **Constraint:** At minimum document that `entity_id` must refer to an entity of that type in the same site; ideally add DB or app checks.

### 6. External ref idempotency

- **SQL:** Keep `UNIQUE(site_id, external_ref) WHERE external_ref IS NOT NULL`. No schema change for NULL (multiple NULLs allowed by design unless you add a different business rule).
- **API:** In POST /api/sales: (1) Normalize `external_ref`: e.g. `trim(String(body.external_ref))` and treat `''` as null if you want. (2) On insert, if error code is 23505 (unique violation), re-fetch by (site_id, external_ref), then update that row (same fields as current update path) and return 200 with the updated sale. (3) Document: NULL external_ref means no upsert; duplicate creates possible.
- **Index:** Existing unique partial index is correct.

### 7. Time window

- **SQL:** Optional: in cron or enqueue RPC, use `conversion_time = LEAST(sale.occurred_at, now())` so future occurred_at does not become future conversion_time for Google.
- **API:** Optional: validate `occurred_at <= now()` or cap to now when creating/updating sale. Document cron window (1–168h) and that sales outside the window are not auto-enqueued (manual backfill if needed).
- **Boundary:** Document that window is [now - hours, +∞) on occurred_at; inclusive left.

---

## D) Final Verdict

| Criterion | Score (0–100) | Notes |
|-----------|----------------|------|
| Tenant isolation | 90 | RPC hardening (can_access_site) in place; linking can still attach arbitrary entity_id without FK/site check. |
| Race safety (confirm / queue / claim) | 95 | Double confirm, cron overlap, worker claim are safe. Late linking backfill is idempotent. |
| Idempotency (external_ref / retries) | 70 | External ref upsert race returns 500 on duplicate insert; NULL allows multiple sales; no normalization. |
| Crash recovery | 60 | No requeue or timeout for PROCESSING; risk of stuck jobs. |
| Data integrity (linking) | 65 | No FK or site-scoped validation on conversation_links.entity_id; orphan/cross-site links possible. |
| Time/attribution edge cases | 75 | Boundary and uniqueness clear; future occurred_at and long-past sales need docs and optional caps. |

**Overall production-readiness score: 72/100**

**Justification (strict):**

- **Strengths:** Confirm is atomic and tenant-checked; queue has one row per sale and ON CONFLICT; claim is concurrency-safe; backfill is non-destructive and idempotent; cron does not create duplicate queue rows.
- **Gaps:** (1) External ref: duplicate insert on concurrent same ref returns 500 and no upsert retry. (2) NULL external_ref allows unbounded duplicate sales per site. (3) Conversation links: no verification that entity_id belongs to the same site/entity type → attribution and reporting can be polluted. (4) No automatic recovery for jobs stuck in PROCESSING after worker crash.
- For a system handling high ad spend and zero tolerance for cross-tenant mutation or attribution corruption, the remaining risks are: **attribution pollution via arbitrary links (P1)** and **duplicate sales / 500 on duplicate ref (P1)**. Addressing the external_ref race and linking validation (and optionally PROCESSING timeout) would raise the score into the mid-80s and make the system suitable for production with clear operational playbooks.
