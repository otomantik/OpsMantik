# SINGULARITY DOSSIER — Event Horizon Fractures

**Date:** 2026-02-25  
**Role:** Turing Award–Level Distributed Systems Theorist  
**Scope:** Mathematical inevitabilities, Byzantine faults, causal consistency violations, and invisible state corruptions over millions of asynchronous mutations  
**Methodology:** CAP-theoretic analysis, write-skew modeling, causal-order simulation, thundering-herd proofs, event-loop blocking analysis

---

## Executive Summary

The architecture uses atomic RPCs (`increment_usage_checked`, `confirm_sale_and_enqueue`) with `SELECT ... FOR UPDATE`, and distributed cron locks (`SET NX EX`). However, PostgreSQL defaults to **READ COMMITTED**; the value-calculator reads mutable state before a long I/O window; event delivery is unordered; cron TTL expiry creates a narrow resonance window; and CPU-bound work shares the V8 event loop with I/O. These produce **theoretical fractures** that can silently corrupt financial or algorithmic integrity over time.

---

## 1. Transactional Write Skew & Phantom Reads (The Ledger Illusion)

### Fracture 1.1 — Value Calculator Stale Read: "One True Math" on Mutable State

- **[Singularity Threat]:** 🕳️ EVENT HORIZON
- **[The Theoretical Paradox]:** **Non-Repeatable Read under READ COMMITTED.** The OCI runner reads `calls` (lead_score, sale_amount) and `sites.oci_config` in `syncQueueValuesFromCalls`, computes `value_cents` via `computeConversionValue`, then calls `adapter.uploadConversions`—which performs an HTTP request to Google Ads (up to 30s). Between the read phase and the HTTP completion, another process (e.g. seal route, calc-brain-score worker) can UPDATE the call (sale_amount, lead_score). The value we send to Google was computed from **stale** state. Result: **financial corruption**—we report a conversion value that no longer reflects the authoritative call state. Over millions of conversions, a non-trivial fraction will have been computed from state that mutated in the read→commit window.
- **[Location]:** `lib/oci/runner.ts` lines 119–175 (`syncQueueValuesFromCalls`), `lib/oci/oci-config.ts` (`computeConversionValue`), `lib/providers/google_ads/adapter.ts` (30s timeout).

```ts
// runner.ts: Read call state, compute value, THEN upload (long I/O)
await syncQueueValuesFromCalls(siteIdUuid, siteRows, prefix);
// ... state can mutate here ...
results = await adapter.uploadConversions({ jobs, credentials }); // up to 30s
```

- **[The Singularity Refactor]:** **Serializable Snapshot Isolation (SSI)** or **Value Snapshot at Claim Time**. Option A: Wrap `syncQueueValuesFromCalls` + `adapter.uploadConversions` in a Postgres `BEGIN ISOLATION LEVEL SERIALIZABLE` transaction—impractical for 30s HTTP. Option B: **Snapshot at claim**—store `value_cents` (and any derived fields) in the `offline_conversion_queue` row at enqueue time, and never re-read from calls during upload. Option C: **Optimistic locking**—include `calls.updated_at` in the queue payload; before upload, re-read call and verify `updated_at` unchanged; if changed, re-sync or abort and retry.

---

### Fracture 1.2 — Quota Gate: Dual Sources of Truth (Phantom Consistency)

- **[Singularity Threat]:** 🌌 REALITY COLLAPSE
- **[The Theoretical Paradox]:** **Phantom read across stores.** `runSyncGates` uses `getUsage(siteIdUuid, yearMonth)` which reads **Redis first**, then `site_usage_monthly`, then `ingest_idempotency` count. The actual gate is `increment_usage_checked`, which reads and updates **`usage_counters`** in Postgres. Redis and `usage_counters` can diverge: Redis is incremented **after** `processSyncEvent` succeeds; `usage_counters` is incremented **before** persist. Under burst, Redis can lag or be ahead. The `evaluateQuota(plan, usage + 1)` decision uses `getUsage`; if that returns a stale low value, we might **allow** when `increment_usage_checked` would reject—but the RPC is the authority, so we reject at the last gate. The inverse: `getUsage` returns a stale **high** value → we reject early, never calling `increment_usage_checked`, and we might have rejected a request that would have been allowed. Result: **conservative over-rejection** (no financial corruption) but **phantom consistency**—the "Ledger Illusion" that our quota check is authoritative when it is merely advisory.
- **[Location]:** `lib/ingest/sync-gates.ts` lines 61–88; `lib/quota.ts` (`getUsage`, `getUsageRedis`, `getUsagePgSnapshot`); `supabase/migrations/20260302000000_sprint1_subscriptions_usage_entitlements.sql` (`increment_usage_checked`).

- **[The Singularity Refactor]:** **Single source of truth.** Remove `getUsage` + `evaluateQuota` as a pre-filter for billable events. Call `increment_usage_checked` first (it is atomic); if it returns LIMIT, then `updateIdempotencyBillableFalse` and reject. This eliminates the phantom—the only read that matters is inside the RPC.

---

### Fracture 1.3 — Plan Cache Stale Read (Write Skew Precursor)

- **[Singularity Threat]:** 🌌 REALITY COLLAPSE
- **[The Theoretical Paradox]:** **Stale read from in-memory cache.** `getSitePlan` uses a per-process `planCache` with 1-minute TTL. In serverless, each cold start gets a fresh cache. If an admin upgrades a site (plan limit 100 → 200) and two workers start concurrently, Worker A may have cached plan (100), Worker B fresh plan (200). Worker A calls `increment_usage_checked` with `p_limit: 100`. If `usage_counters` is 150, the RPC rejects. Worker B calls with `p_limit: 200` and allows. No global invariant is violated—each RPC is atomic. But Worker A's **decision** was based on stale plan. Under rapid plan changes, we get non-deterministic acceptance/rejection for the same logical event. **Theoretical write skew:** two workers read "plan allows," each commits an increment; if the plan was downgraded between reads, we could exceed the new limit. Mitigated because `increment_usage_checked` receives the limit as a parameter and re-reads usage inside the transaction—so the only skew is "we used an outdated limit," which can only make us more conservative.
- **[Location]:** `lib/quota.ts` lines 47–88 (`getSitePlan`, `planCache`, `CACHE_TTL_MS`).

- **[The Singularity Refactor]:** **Shorten TTL** to 10–30 seconds, or **invalidate on write** (e.g. Redis pub/sub when plan changes). For strict consistency, fetch plan inside the same transaction as `increment_usage_checked` via an RPC that returns both.

---

## 2. Causal Reordering & Chrono-Anarchy (Eventual Inconsistency)

### Fracture 2.1 — V5_SEAL Before V2_PULSE: Out-of-Order Delivery

- **[Singularity Threat]:** 🌌 REALITY COLLAPSE
- **[The Theoretical Paradox]:** **Causal inconsistency in a multi-queue system.** Events flow: Webhooks/Sync → QStash → Worker; Call-Event/Seal → HTTP or QStash → Worker. QStash does not guarantee order across messages. A V5_SEAL (sale confirmed, conversion enqueued) can be processed **before** the V2_PULSE (intent signal) that causally preceded it. The orchestrator's `hasRecentV2Pulse` checks `marketing_signals` for `call_id` or `gclid` in the last 24h. V5_SEAL does **not** insert into `marketing_signals`—it routes to `offline_conversion_queue`. So when V2 arrives late, it will **not** find a prior V2 for that call and will insert a new row. Result: **duplicate or out-of-order signals**—we may send both a V5 conversion and a V2 decay signal to Google, with V2 having a timestamp that appears to predate the conversion. Google's attribution model may misattribute or double-count. The 5-Gear Time Decay formula `calculateSignalEV(gear, aov, clickDate, signalDate)` uses `signalDate` from the event payload. If the payload timestamp is client-controlled and a delayed V2 has an old timestamp, we compute decay from that old date—**chrono-anarchy**: the logical order of events is violated.
- **[Location]:** `lib/domain/mizan-mantik/orchestrator.ts` (`evaluateAndRouteSignal`, `hasRecentV2Pulse`); `lib/domain/mizan-mantik/time-decay.ts` (`calculateSignalEV`); `lib/idempotency.ts` (`getV2TimeComponentSafe`—uses server time for click/call_intent to mitigate).

- **[The Singularity Refactor]:** **Vector Clocks or Lamport Timestamps.** Attach a logical timestamp to each event at ingestion; process in causal order per `(site_id, session_id)` or `(site_id, call_id)`. Option B: **Per-entity queue**—hash `(site_id, call_id)` to a partition; all events for that call go to the same partition and are processed in order. Option C: **Accept out-of-order, dedupe by content**—use a content-addressable dedup (e.g. hash of `site_id + call_id + gear + timestamp_bucket`) so that a delayed duplicate V2 is idempotently dropped.

---

### Fracture 2.2 — State Machine: No Overwrite, But No Causal Guarantee

- **[Singularity Threat]:** ☢️ ANOMALY
- **[The Theoretical Paradox]:** **Eventual consistency without happens-before.** `marketing_signals` is INSERT-only—we never overwrite newer with older. `calls` and `sales` use status transitions (DRAFT → CONFIRMED). The seal RPC checks `status IS DISTINCT FROM 'DRAFT'` before update. So we do **not** blindly overwrite. However, we have **no causal guarantee** that an older event (e.g. draft update) cannot be processed after a newer one (seal). If a delayed "draft" mutation arrived after "seal," it would be rejected by the status check. The remaining risk: **timestamp inversion** in the decay formula. If `signalDate < clickDate` (e.g. client clock skew), `elapsedMs = max(0, signalDate - clickDate)` clamps to 0—we get full decay. That is a safe default. But if both are client-supplied and maliciously crafted, we could get arbitrary decay values. V2 idempotency uses **server time** for click/call_intent to prevent this; heartbeat/page_view may use payload ts if within 5 min of server.
- **[Location]:** `lib/domain/mizan-mantik/time-decay.ts`; `lib/idempotency.ts` (`getV2TimeComponentSafe`); `supabase/migrations/20260226000005_confirm_sale_marketing_consent.sql`.

- **[The Singularity Refactor]:** **Server-side timestamps only** for all value-affecting events. Reject or clamp payload timestamps outside a tight window (e.g. ±2 min of server). Use **Hybrid Logical Clocks (HLC)** if logical ordering is required across services.

---

## 3. The Thundering Herd & Cache Stampede (Resonance Cascades)

### Fracture 3.1 — Cron Lock TTL Expiry: Resonance Window

- **[Singularity Threat]:** 🕳️ EVENT HORIZON
- **[The Theoretical Paradox]:** **Deterministic resonance at TTL boundary.** The cron lock uses Redis `SET key value NX EX ttlSeconds`. For `process-offline-conversions`, TTL = 660 sec (11 min); schedule = 10 min. At T=0, Cron1 acquires the lock and starts. At T=600 (10 min), Cron2 fires. Lock is still held; Cron2 skips. At T=660, the lock **expires**. Cron1 may still be running (if it took >11 min) or may have crashed without calling `releaseCronLock`. At T=660.001 ms, the lock is **free**. If Cron3 fires at T=660 (e.g. cron schedule has 1-min granularity and T=660 falls on a tick), Cron3 acquires. We now have **Cron1 and Cron3 running in parallel**—double processing, duplicate claims (mitigated by FOR UPDATE SKIP LOCKED), and **connection pool pressure**. Under heavy backlog, multiple crons (recover, process-offline-conversions, sweep, reconcile) can be scheduled to run at the same wall-clock second. Each acquires its **own** lock (different keys). All four run in parallel. Each opens Supabase connections. **Resonance cascade**: 4 crons × N connections each + QStash worker burst = pool exhaustion before any lock is re-acquired.
- **[Location]:** `lib/cron/with-cron-lock.ts`; `app/api/cron/process-offline-conversions/route.ts` (CRON_LOCK_TTL_SEC = 660); `app/api/cron/recover/route.ts` (420); `app/api/cron/sweep-unsent-conversions/route.ts` (300); `app/api/cron/reconcile-usage/route.ts` (600).

- **[The Singularity Refactor]:** **Jittered backoff and staggered schedules.** Add random jitter (e.g. 0–60 sec) to cron invocation so they do not all fire at the same millisecond. Use **lease renewal** (heartbeat): the lock holder periodically extends TTL (e.g. every 2 min) so that a long run does not lose the lock. On crash, TTL eventually expires—no permanent lock. **Stagger cron schedules** (e.g. recover at :00, process-offline at :02, sweep at :05, reconcile at :10) to avoid simultaneous DB load.

---

### Fracture 3.2 — QStash Fan-Out: Connection Pool Exhaustion

- **[Singularity Threat]:** 🕳️ EVENT HORIZON
- **[The Theoretical Paradox]:** **Thundering herd from queue drain.** QStash delivers messages to the ingest worker. Under backlog (e.g. 500 messages queued), QStash can fan out to many concurrent HTTP requests. Each request triggers a serverless invocation. Each invocation acquires a Supabase connection for `adminClient` and `createTenantClient`. Supabase/PgBouncer typically allows ~100–200 connections. 500 concurrent workers → 500 connection attempts. The pool exhausts. New requests block or timeout. Workers retry (QStash retry). Retries add more load. **Resonance cascade**: pool exhaustion → timeouts → retries → more exhaustion. The system does not self-heal; it **oscillates** until backlog is drained or cron/rate limits throttle delivery.
- **[Location]:** `app/api/workers/ingest/route.ts`; QStash configuration; Supabase connection pool settings.

- **[The Singularity Refactor]:** **Concurrency limit at the queue boundary.** Configure QStash (or an API gateway) to limit concurrent deliveries (e.g. max 20 in-flight). Use **connection pooler** (PgBouncer) in transaction mode. Implement **backpressure**: if pool utilization exceeds a threshold, return 503 to QStash so it backs off. Use **semaphore** (Redis) to limit concurrent worker invocations per site or globally before opening DB connections.

---

## 4. V8 Event Loop Asphyxiation & Ephemeral Desync

### Fracture 4.1 — Synchronous JSON Parse and Zod Validation

- **[Singularity Threat]:** 🌌 REALITY COLLAPSE
- **[The Theoretical Paradox]:** **CPU-bound work blocks I/O.** `req.json()` uses synchronous `JSON.parse`. A 256KB batch (100 events × ~2.5KB) can block the event loop for 10–50ms. `parseValidIngestPayload` and `parseValidWorkerJobData` run Zod validation and normalization—more CPU. The ingest worker then does Redis (fraud check), Supabase (gates, persist), and potentially QStash (fallback publish). If the event loop is blocked for 100ms during parse+validate, **all** I/O callbacks (Redis responses, Supabase responses, fetch timeouts) are delayed. A Google Ads API request with 30s timeout might complete in 200ms real time, but if the event loop was blocked for 500ms before the response arrived, the **observed** latency is 700ms. Under sustained load, cumulative blocking can cause **artificial latency spikes** that trigger our circuit breaker (`record_provider_outcome`) or timeout logic. **Ephemeral desync**: the system *believes* the provider is slow or failing when the delay was self-inflicted.
- **[Location]:** `app/api/sync/route.ts` (req.json); `app/api/workers/ingest/route.ts` (rawBody = await req.json()); `lib/types/ingest.ts` (parseValidWorkerJobData, parseValidIngestPayload); `lib/providers/google_ads/adapter.ts` (REQUEST_TIMEOUT_MS = 30_000).

- **[The Singularity Refactor]:** **Worker Threads** for CPU-bound parsing. Offload `JSON.parse` + Zod validation to a Worker; keep the main thread for I/O. Option B: **Streaming parser** (e.g. `stream-json`) to avoid loading the full body into memory and parsing in one shot. Option C: **Chunk processing**—parse and validate in small batches (e.g. 10 events at a time) with `setImmediate` yields between batches to allow I/O to run.

---

### Fracture 4.2 — OCI Mapper and Value Sync: Mixed CPU and I/O

- **[Singularity Threat]:** ☢️ ANOMALY
- **[The Theoretical Paradox]:** **CPU and I/O on the same thread.** `syncQueueValuesFromCalls` fetches calls from Supabase, then iterates rows and computes `computeConversionValue` for each. `mapJobsToClickConversions` iterates jobs and builds Google request objects. These are O(n) with simple math—likely &lt;10ms for 200 rows. But they run **before** the 30s `adapter.uploadConversions` fetch. If the batch is large (e.g. 500 rows after a future limit increase) or the mapper is extended with heavy logic (e.g. currency conversion, complex decay), the CPU time could grow. **Mixed workload**: the runner does DB reads → CPU (value sync, mapper) → HTTP (Google). Any CPU spike delays the HTTP start and can cause tail latency to exceed timeouts. The circuit breaker uses `record_provider_outcome` with success/failure and transient flags. A timeout caused by event-loop blocking could be misclassified as a transient provider error, causing unnecessary retries and potential circuit flapping.
- **[Location]:** `lib/oci/runner.ts` (syncQueueValuesFromCalls, queueRowToConversionJob); `lib/providers/google_ads/mapper.ts`; `lib/oci/oci-config.ts` (computeConversionValue).

- **[The Singularity Refactor]:** **Isolate CPU-bound work.** Move value computation and mapping to a Worker thread or a separate microservice. Ensure the HTTP request starts **before** any batch CPU work—e.g. stream or paginate so that the first request is sent quickly. Add **latency budget** checks: if elapsed time from claim to first byte sent exceeds a threshold (e.g. 2s), log and consider aborting to avoid timeout.

---

## Summary Matrix

| Fracture                        | Threat         | Pillar              | Refactor                                  |
|--------------------------------|----------------|---------------------|-------------------------------------------|
| Value Calculator Stale Read    | 🕳️ EVENT HORIZON | Write Skew          | Snapshot at claim; optimistic locking     |
| Quota Dual Sources             | 🌌 REALITY COLLAPSE | Phantom Read     | Single gate: increment_usage_checked only  |
| Plan Cache Stale               | 🌌 REALITY COLLAPSE | Write Skew       | Short TTL; invalidate on write             |
| V5 Before V2 Causal Reorder    | 🌌 REALITY COLLAPSE | Causal Consistency | Vector clocks; per-entity queue            |
| Timestamp Inversion            | ☢️ ANOMALY      | Chrono-Anarchy      | Server timestamps only; HLC                |
| Cron Lock TTL Resonance        | 🕳️ EVENT HORIZON | Thundering Herd     | Jittered backoff; lease renewal; stagger   |
| QStash Fan-Out Pool Exhaustion | 🕳️ EVENT HORIZON | Resonance Cascade   | Concurrency limit; backpressure; semaphore |
| JSON Parse Blocking            | 🌌 REALITY COLLAPSE | Event Loop       | Worker threads; streaming parser           |
| OCI Mapper CPU + I/O           | ☢️ ANOMALY      | Ephemeral Desync    | Isolate CPU; latency budget                |

---

**End of Singularity Dossier**
