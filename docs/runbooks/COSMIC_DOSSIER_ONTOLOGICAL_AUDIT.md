# COSMIC DOSSIER — Ontological Fractures

**Date:** 2026-02-25  
**Role:** Cosmic Systems Engineer / Ontological Theorist  
**Scope:** Hardware-level determinism failures, relativistic time drift, entropy pool exhaustion, and Byzantine infrastructure lies  
**Methodology:** Physics-of-time analysis, PRNG entropy modeling, SEU/checksum audit, distributed-lock Byzantine failure analysis

---

## Executive Summary

The system assumes a Newtonian "now," a trustworthy PRNG, uncorrupted memory, and an honest Redis. In reality, **NTP drift** makes "now" interval-valued; **entropy exhaustion** in serverless can (in theory) make UUIDs repeat; **no application-level integrity checks** protect payloads from single-event upsets before commit; and **no fencing tokens** protect the database from a lock that Redis has already revoked. The codebase does not crash on negative time deltas (it clamps), but it can **misattribute value** when clocks disagree; ledger identity is **SHA-256–based** and thus not vulnerable to UUID collision, while **trace and batch identifiers** are.

---

## 1. Relativistic Time Drift & Clock Smear (The Illusion of "NOW")

### Fracture 1.1 — Single-Source "Now" With No Uncertainty Interval

- **[Cosmic Threat]:** 🪐 TIME DILATION
- **[The Ontological Paradox]:** **There is no global "now."** All time is taken from the local node via `Date.now()` or `new Date()`. In a distributed deployment (e.g. Frankfurt sync, Washington worker, or multi-region Vercel), each node has its own NTP-synchronized clock. NTP can drift by tens of milliseconds; leap-second smear or asymmetric network delay can make one node's "now" differ from another's by 50–500 ms. The codebase **never** uses an uncertainty interval (e.g. Spanner TrueTime's "[earliest, latest]"). It treats "now" as a scalar. Idempotency buckets (`timeBucket5s()`, v2 time components) and `getServerNowMs()` are computed per-node. Result: the same logical event processed on two nodes can get **different** idempotency keys (different buckets) and be double-counted, or the same key on two nodes can map to different real-time instants—**temporal non-determinism**.
- **[Location]:** `lib/idempotency.ts` (`getServerNowMs()`, `timeBucket5s()`, `getV2TimeComponentSafe`); `app/api/sync/route.ts` (computeIdempotencyKeyV2 with getServerNowMs()); `lib/ingest/sync-gates.ts` (same). All `new Date().toISOString()` and `Date.now()` across `lib/oci/runner.ts`, cron routes, and ingest paths.

- **[The Cosmic Refactor]:** **Clock-bound consensus** or **TrueTime-style API.** Option A: Use a time API that returns an interval `[earliest, latest]` and only commit when "now" is after `latest` (Google Spanner). Option B: **Single time authority**—all "now" comes from one service (e.g. Redis TIME or a dedicated time API) so idempotency and decay use a single logical clock. Option C: **Hybrid Logical Clocks (HLC)**—attach a logical timestamp to each event at ingestion and use it for ordering and bucketing so that small wall-clock drift does not change the logical bucket.

---

### Fracture 1.2 — Negative Temporal Vector: Conversion "Before" Click

- **[Cosmic Threat]:** 🪐 TIME DILATION
- **[The Ontological Paradox]:** **Causal paradox from clock skew.** If Node A (Frankfurt) records a click at wall-clock T, and Node B (Washington) records the conversion with a clock **50 ms behind**, Node B's `conversion_time` can be **less** than the click time stored by Node A. The 5-Gear Time Decay uses `elapsedMs = signalDate.getTime() - clickDate.getTime()`. The code uses `Math.max(0, elapsedMs)` so **negative elapsedMs becomes 0**. Then `days = Math.ceil(0 / MS_PER_DAY) = 0`. So we do **not** crash (no NaN, no negative revenue). But we **semantically** treat the conversion as happening the same "day" as the click (full decay multiplier: 0.5 for V2/V3/V4 in the ≤3-day bucket). In reality, the conversion happened "after" the click in causal order but "before" in the skewed clock of Node B. Result: **over-attribution**—we may assign a higher decay multiplier than the true elapsed time would warrant. Over millions of events, systematic skew in one region can bias ROAS and decay math. The formula does not "crash"; it **silently produces the wrong value**.
- **[Location]:** `lib/domain/mizan-mantik/time-decay.ts` lines 76–77 (`elapsedMs = Math.max(0, signalDate.getTime() - clickDate.getTime())`, `days = Math.ceil(elapsedMs / MS_PER_DAY)`).

```ts
const elapsedMs = Math.max(0, signalDate.getTime() - clickDate.getTime());
const days = Math.ceil(elapsedMs / MS_PER_DAY);
```

- **[The Cosmic Refactor]:** **Reject or quarantine negative deltas.** If `elapsedMs < 0`, do not use the decay formula; either drop the signal, store it for manual review, or use a sentinel value and alert. Option B: **Single time source** so click and conversion timestamps are comparable. Option C: **Logical timestamps** (HLC) so ordering is causal even when wall clocks disagree.

---

### Fracture 1.3 — Leap Second and Smear

- **[Cosmic Threat]:** ☢️ ANOMALY
- **[The Ontological Paradox]:** **Leap seconds** cause `Date.now()` to repeat or jump. During a positive leap second, the same millisecond value can occur twice; during smear, the clock advances non-monotonically. Idempotency keys that include `timeBucket5s()` or v2 time components can **collapse** (two distinct events in the same smear window get the same key) or **diverge** (one event gets two keys if processed across a jump). The codebase does not use a leap-second–aware or monotonic clock. Risk is **low frequency** (leap seconds are rare) but **ontologically real**.
- **[Location]:** All `Date.now()` and `new Date()` usage; `lib/idempotency.ts` (time buckets).

- **[The Cosmic Refactor]:** **Monotonic clock** for ordering (e.g. `process.hrtime.bigint()` for relative ordering) combined with wall clock for display. Or use a time API that explicitly handles leap seconds (e.g. TAI or smear-aware NTP).

---

## 2. PRNG Entropy Exhaustion & Cryptographic Determinism

### Fracture 2.1 — UUID v4 and ingest_id: Entropy-Dependent Identity

- **[Cosmic Threat]:** ☄️ ENTROPY COLLAPSE
- **[The Ontological Paradox]:** **UUID v4 requires 122 bits of cryptographically secure randomness.** In high-throughput serverless environments (e.g. Vercel), each cold start may share a thin OS entropy pool (`/dev/urandom`). Under extreme load or in constrained containers, the PRNG state can become predictable or repeat. The codebase uses `crypto.randomUUID()` for: `ingest_id` (sync route), `batch_id` (OCI runner), `pv_id` (orchestrator), semaphore tokens, `request_id` (middleware), and fallback `Date.now()-${Math.random()}` when randomUUID is missing. **Ledger identity** (idempotency key) is **SHA-256–based** and does **not** depend on random UUIDs—so two "merged" leads would only share a ledger entry if they had the same (site, event_name, url, fingerprint, bucket), which is unaffected by UUID collision. However, **ingest_id** is used for tracing and correlation; a collision would merge two distinct requests in logs and Sentry. **batch_id** in `provider_upload_attempts` could collide, causing two batches to be confused in metrics. **Semaphore token** collision could allow one worker to release another's slot. So: **no financial ledger merge from UUID collision** (idempotency is deterministic hash), but **trace corruption, metric corruption, and semaphore bugs** are theoretically possible under entropy exhaustion.
- **[Location]:** `app/api/sync/route.ts` line 322 (`ingestId = globalThis.crypto?.randomUUID ? ... : \`${Date.now()}-${Math.random()...}\``); `lib/oci/runner.ts` (batchId = crypto.randomUUID()); `lib/domain/mizan-mantik/orchestrator.ts` (pv_id); `lib/providers/limits/semaphore.ts` (token = crypto.randomUUID()); `middleware.ts` (requestId).

- **[The Cosmic Refactor]:** **Entropy pooling** or **deterministic identifiers where possible.** For batch_id and ingest_id, consider **compound keys** (e.g. `nodeId + monotonicCounter + timestamp`) so that uniqueness does not rely solely on the PRNG. For semaphore tokens, use **fencing tokens** (monotonically increasing sequence from Redis or DB) so that even if two tokens collide, the DB can reject the stale one. **Health-check** the PRNG (e.g. sample and test for obvious repetition in dev/staging).

---

### Fracture 2.2 — Idempotency Key: Deterministic (Safe)

- **[Cosmic Threat]:** N/A — No entropy dependence.
- **[The Ontological Paradox]:** Idempotency keys are **SHA-256(site_id:event_name:url:fingerprint:time_component)**. No random input. Entropy exhaustion **cannot** cause two distinct events to get the same idempotency key; only identical inputs (or a SHA-256 collision, which is negligible) can. **Ledger merge from PRNG failure is not in the threat model.**
- **[Location]:** `lib/idempotency.ts` (`computeIdempotencyKey`, `computeIdempotencyKeyV2`).

- **[The Cosmic Refactor]:** None. Preserve deterministic hashing for invoice authority.

---

## 3. Single-Event Upsets (SEU) & Cosmic Ray Bit Flips

### Fracture 3.1 — No Application-Level Integrity Check Before Commit

- **[Cosmic Threat]:** ☄️ ENTROPY COLLAPSE (interpreted as physical entropy / bit flips)
- **[The Ontological Paradox]:** **A single high-energy particle can flip one bit in RAM.** The application builds an in-memory payload (e.g. idempotency row, queue row, marketing_signal row) and sends it to Postgres. Between the last application read of that buffer and the write to the WAL, a bit flip can change `value_cents`, `site_id`, or any field. Postgres has **page-level checksums** (if enabled) and WAL integrity, but the **application payload** is not checksummed by the app. We do not compute an HMAC or Merkle root of the row before insert and we do not verify after insert. So we **blindly trust the memory matrix**. Result: **silent data corruption**—a flipped bit in `value_cents` could send the wrong conversion value to Google or invoice the wrong amount; a flipped bit in `site_id` could attribute revenue to the wrong tenant. Probability is extremely low per write but **non-zero**; at scale, the expected value of corruption is non-zero.
- **[Location]:** All `adminClient.from(...).insert(...)` and `.update(...)` paths: `lib/idempotency.ts` (tryInsertIdempotencyKey); `lib/ingest/process-sync-event.ts` (processed_signals, sessions, events, marketing_signals); `lib/oci/runner.ts` (offline_conversion_queue updates); `lib/domain/mizan-mantik/orchestrator.ts` (marketing_signals); pipeline-service, enqueue-seal-conversion, etc. **No** checksum or HMAC of the payload before or after write.

- **[The Cosmic Refactor]:** **Application-level Merkle or HMAC.** Before insert, compute `checksum = HMAC(secret, canonical_serialize(row))` and store it in a column or in a separate integrity table. After insert (or in a periodic job), re-read and verify. Option B: **Postgres page checksums** and ECC memory in critical infra (already a deployment concern). Option C: **Critical-field parity**—e.g. store `value_cents` and `value_cents_parity` (XOR of bytes) and reject on mismatch at read.

---

### Fracture 3.2 — Incoming Request Integrity (Partial)

- **[Cosmic Threat]:** ☢️ ANOMALY (mitigated for some paths)
- **[The Ontological Paradox]:** **Inbound** integrity is partially enforced: call-event uses **HMAC** (`verify_call_event_signature_v1`); GDPR consent uses HMAC. Sync ingest does **not** sign payloads—we trust the body. So SEU or MITM on the wire could corrupt the sync payload before it reaches our memory; we have no integrity check on that path. For call-event, the HMAC protects the body in transit; once in memory, we still have no post-insert checksum.
- **[Location]:** `lib/security/verify-signed-request.ts`; `app/api/call-event/v2/route.ts` (HMAC verify); sync route has no body signature.

- **[The Cosmic Refactor]:** Extend HMAC or signature to sync payloads if integrity in transit is required. For SEU, the refactor in 3.1 (checksum before/after commit) is the main defense.

---

## 4. The Byzantine Infrastructure Nightmare

### Fracture 4.1 — Redis Lock: No Fencing Token

- **[Cosmic Threat]:** ☄️ ENTROPY COLLAPSE (Byzantine failure)
- **[The Ontological Paradox]:** **Redis can "lie" or lose state.** We use `redis.set(key, value, { nx: true, ex: ttlSeconds })`. If the master acknowledges `OK` and then **dies before replicating** to a replica (network partition, failover), the lock never existed on the new master. A second cron invocation tries to acquire and gets `OK`. We now have **two** crons believing they hold the lock. Neither passes a **fencing token** (monotonic sequence) to the database. So when Cron1 (the "zombie"—it held the lock that was lost) performs a mutation (e.g. `get_and_claim_fallback_batch`, or any Supabase write), the DB cannot tell that Cron1's lock was revoked. Cron2 also runs and mutates. Result: **double processing**—e.g. the same fallback row claimed twice, or the same queue batch processed by two runners. The codebase stores the lock **value** as `Date.now()` but **never** sends that value to Supabase. There is no `WHERE lock_token > previous_max_token` or equivalent. So we have **no fencing**.
- **[Location]:** `lib/cron/with-cron-lock.ts` (tryAcquireCronLock stores value = Date.now(), never validated by DB); all active cron routes that acquire this lock then call Supabase (recover, process-offline-conversions, sweep-unsent-conversions, reconcile-usage, providers/recover-processing, OCI reconcile/process jobs).

- **[The Cosmic Refactor]:** **Fencing tokens.** Option A: **DB-backed sequence**—before doing cron work, call an RPC that increments a sequence and returns the new value (e.g. `next_cron_fence('recover')` → 42). Pass 42 to every mutation in that run (e.g. store `cron_fence = 42` on claimed rows). Reject any mutation where the row's existing `cron_fence` is >= current run's token (stale run). Option B: **Redis Redlock + token**—store a monotonically increasing token in Redis (INCR) when acquiring the lock; pass that token to the DB and have the DB only accept writes with token greater than the last accepted. Option C: **Lease with validation**—periodically re-validate the lock (GET key === myValue) and abort if lost; reduces but does not eliminate the window.

---

### Fracture 4.2 — Semaphore Token: No DB-Side Validation

- **[Cosmic Threat]:** ☢️ ANOMALY
- **[The Ontological Paradox]:** The OCI runner uses a **Redis semaphore** (ZSET, token = crypto.randomUUID()). The token is used only to **release** the same slot (ZREM member). The database (Supabase) never sees the token. So if Redis loses the semaphore state (failover, partition), two workers could believe they hold a slot and both proceed to upload. The **claim** of queue rows is done via Postgres `claim_offline_conversion_jobs_v2` (FOR UPDATE SKIP LOCKED), so each row is only claimed by one transaction. The **double execution** would be: two workers claim **different** rows (no overlap), but both exceed the intended concurrency limit (e.g. we wanted max 2 per site, now 4 run). So we get **overload**, not double-processing of the same row. The Byzantine risk is **resource exhaustion** and possible provider rate-limit, not ledger corruption. Still, the semaphore is **not** enforced by the DB.
- **[Location]:** `lib/providers/limits/semaphore.ts`; `lib/oci/runner.ts` (acquireSemaphore before upload, release in finally).

- **[The Cosmic Refactor]:** **DB-enforced concurrency**—e.g. a table `concurrency_slots(site_id, provider_key, slot_id, expires_at)` with a constraint that count per (site_id, provider_key) <= N, and claim/release via the same DB. Then Redis is only a cache; the DB is the authority.

---

### Fracture 4.3 — Supabase: No Application-Level Verification of Responses

- **[Cosmic Threat]:** ☢️ ANOMALY
- **[The Ontological Paradox]:** We assume Supabase (and thus Postgres) returns correct data. If the database or the network **corrupts** a response (Byzantine or SEU in the reply path), we could read back wrong values and act on them. We do not verify checksums on read. This is **theoretical** (Postgres and TLS provide strong guarantees) but ontologically possible. Lower priority than lock fencing and payload checksums.
- **[Location]:** All `adminClient.from(...).select(...)` and RPC calls.

- **[The Cosmic Refactor]:** For critical reads (e.g. value_cents before sending to Google), recompute or verify from a second source if available; or store and verify application-level checksums on read.

---

## Summary Matrix

| Fracture                          | Threat              | Pillar        | Refactor                                  |
|-----------------------------------|---------------------|---------------|-------------------------------------------|
| Single-Source "Now"               | 🪐 TIME DILATION    | Clock Smear   | TrueTime-style interval; single time auth; HLC |
| Negative Temporal Vector          | 🪐 TIME DILATION    | Decay Math    | Reject/quarantine negative delta; single time source |
| Leap Second / Smear               | ☢️ ANOMALY          | Clock         | Monotonic clock; TAI/smear-aware time     |
| UUID / ingest_id Entropy          | ☄️ ENTROPY COLLAPSE | PRNG          | Compound keys; fencing tokens; health-check |
| Idempotency Key                   | N/A                 | PRNG          | None (deterministic)                      |
| No Checksum Before Commit         | ☄️ ENTROPY COLLAPSE | SEU           | Application Merkle/HMAC; verify after     |
| Inbound Integrity (Sync)          | ☢️ ANOMALY          | SEU/MITM      | Optional body signature                   |
| Redis Lock No Fencing             | ☄️ ENTROPY COLLAPSE | Byzantine     | Fencing tokens; DB sequence               |
| Semaphore No DB Validation        | ☢️ ANOMALY          | Byzantine     | DB-enforced concurrency                   |
| Supabase Response Integrity       | ☢️ ANOMALY          | Byzantine     | Checksum on read; verify critical fields  |

---

**End of Cosmic Dossier**
