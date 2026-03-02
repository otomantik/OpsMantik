# Causal Integrity Report — Event Horizon Scan

> **Quantum Systems Theorist & Causal Integrity Oracle**  
> Sub-atomic paradox analysis across unified codebase and 5 Dossiers  
> **Scan Date:** 2026-02-25

---

## Executive Summary

This report identifies four classes of "God-Level" anomalies that bypass standard testing, logging, and formal verification. Each anomaly is analyzed for its ontological flaw, production manifestation, and axiomatic correction.

**Cross-Reference:** EXTINCTION, DOOMSDAY, COSMIC, OMEGA, AZATHOTH Dossiers; SYSTEMIC_ANOMALY_CHRONO_DRIFT_REPORT.

---

## 1. The Observer's Paradox (Heisenberg Traps)

### 1.1 The Singularity

**Quantum Zeno Interrogation: Does observation prevent resolution?**

### 1.2 The Ontological Flaw

In quantum mechanics, the Zeno effect occurs when frequent measurement of a system prevents its evolution. The question: *Does our locking and recovery logic create a scenario where "observing" a row (via claim RPCs or recovery crons) prevents it from ever leaving PROCESSING?*

**Analysis:**

- **offline_conversion_queue** — `claim_offline_conversion_jobs_v2` uses `FOR UPDATE SKIP LOCKED` to select QUEUED/RETRY rows, set `claimed_at`, and transition to PROCESSING. The recovery RPC `recover_stuck_offline_conversion_jobs` performs a **bulk UPDATE** `WHERE status = 'PROCESSING' AND claimed_at < cutoff` → RETRY or FAILED. There is **no read-modify-write loop** that could be perturbed by observation. The recovery does not "measure" the row in a way that changes its eligibility; it applies an atomic UPDATE. Once `claimed_at` exceeds `min_age_minutes`, the row will be moved on the next recovery run.

- **Conclusion:** The OCI claim/recovery path does **not** exhibit Quantum Zeno. Observation (recovery cron) does not prevent evolution; it *drives* it (PROCESSING → RETRY).

**However — Inverse Heisenberg (Phantom State):**

- **ingest_fallback_buffer** (OMEGA 1.1): `get_and_claim_fallback_batch` selects **only** `WHERE status = 'PENDING'`. Rows are transitioned to PROCESSING. If the cron process **crashes** after the RPC returns but **before** the bulk update (RECOVERED or PENDING), those rows remain in PROCESSING forever. The system has **no axiom** that ever selects for `status = 'PROCESSING'`. This is the inverse of Zeno: **incomplete observation** leaves state undecidable — the row was "observed" (claimed) but the measurement was never completed. The state exists in the DB but is unreachable by the system's own inference rules.

### 1.3 The Simulation Failure

**Ghost in the Machine:** Rows in `ingest_fallback_buffer` with `status = 'PROCESSING'` and `updated_at` older than the cutoff are **zombies** until recovered. The daily cleanup runs `recover_stuck_ingest_fallback(p_min_age_minutes=120)`, which **does** select PROCESSING rows and reset them to PENDING. So the axiom exists — but it runs **daily** with a 2h cutoff. A PROCESSING zombie can sit for up to **~24 hours** (until the next cleanup) before recovery. The 5-min recover cron selects only PENDING; it never observes PROCESSING. So the Phantom State fracture is **partially mitigated** — the oracle exists but runs on a much slower cadence than the recover cron.

### 1.4 The Axiomatic Correction

1. **offline_conversion_queue:** No change required for Zeno; current design is sound.
2. **ingest_fallback_buffer:** The axiom exists — `recover_stuck_ingest_fallback` selects PROCESSING and resets to PENDING. **Tighten the window:** Call it from the 5-min recover cron (or a separate high-frequency cron) with a 15–30 min cutoff instead of only daily with 2h. This makes PROCESSING zombies recoverable within minutes rather than hours.

---

## 2. Chronological Entropy (The Arrow of Decay)

### 2.1 The Singularity

**Temporal Poisoning: Time as a Vector with Uncertainty**

### 2.2 The Ontological Flaw

The system treats time as a **scalar** — a single value. There is no uncertainty interval (e.g. Spanner TrueTime `[earliest, latest]`). Client timestamps (`conversion_time`, `occurredAt`) are trusted without bounds checks. NTP drift, leap seconds, and clock smear can produce:

- **Negative temporal vector** (COSMIC 1.2): If Node A records a click at T and Node B records a conversion with a clock 50ms behind, `signalDate < clickDate`. The code uses `Math.max(0, elapsedMs)` — negative becomes 0. `days = 0` → full decay multiplier. **Silent over-attribution**: we assign a higher value than causal ordering would warrant.

- **Future timestamps (Clock Smear):** A client sending `conversion_time` from the future is not rejected. The export sorts by `conversion_time`; invalid or extreme values can corrupt ordering.

- **Temporal poisoning:** A single row with `conversion_time = "Invalid Date"` or epoch 0 produces `new Date(...).getTime() === NaN`. In `google-ads-export`, sorting by `getTime()` with NaN yields **unpredictable** comparator behavior. One corrupted row can "infect" the sort order of an entire tenant's batch.

### 2.3 The Simulation Failure

**Ghost in the Machine:** A poisoned row causes the export batch to be sorted incorrectly. Conversions may be sent to Google in wrong order; deduplication and session merging logic (earliest conversion per session) can misbehave. Internal analytics show revenue at wrong times; ROAS and attribution drift without any explicit error.

### 2.4 The Axiomatic Correction

1. **Reject or quarantine negative deltas:** If `elapsedMs < 0` in time-decay, do not use the decay formula; quarantine the signal or return UNDECIDABLE.
2. **Timestamp sanity window:** Reject payloads with `conversion_time` or `occurredAt` outside `[now - 1 year, now + 24 hours]` at ingest.
3. **Defensive sort:** Before sorting by `conversion_time`, filter or separate rows where `isNaN(new Date(ts).getTime())`; log and exclude from batch or route to quarantine.
4. **Single time authority:** Consider a time API (Redis TIME or trusted HTTP) for critical idempotency and decay paths to reduce cross-node clock skew.

---

## 3. The Identity Singularity (Entropy Exhaustion)

### 3.1 The Singularity

**Data Nihilism: When Deduplication Erases Real Value**

### 3.2 The Ontological Flaw

**Paradox:** Two conversions that are mathematically identical in every field (same gclid, same conversion_time to the second, same value) but represent two distinct human intents. How does the system decide which "exists" and which is "void"?

**Current state:**

- **Order ID (Extinction 4.1 — mitigated):** `buildOrderId` now includes `rowId` and `deterministicSuffix(clickId, conversionTime, rowId, valueCents)`. Different queue rows → different orderIds. **Collision risk:** mitigated.

- **V2_PULSE dedup:** `hasRecentV2Pulse(siteId, callId, gclid)` — if the same `call_id` or same `site_id + gclid` produced a signal in the last 24h, the second is **dropped**. Two distinct human intents (e.g. two form submits in the same session) can be collapsed into one. The shadow_decisions log records the rejection, but the **value is lost** — we never persist the second conversion. **Silent Deletion.**

- **offline_conversion_queue:** `UNIQUE(call_id)` — one conversion per call. Schema enforces: two sales in the same "call" (edge case) cannot coexist. The second insert fails with 23505.

- **SHA-256 idempotency:** Deterministic; no entropy dependence. Two identical events (same site, event_name, url, fingerprint, bucket) correctly deduplicate. No collision risk.

### 3.3 The Simulation Failure

**Ghost in the Machine:** A sales team closes two deals in the same call session. The first is sealed and enqueued. The second seal attempt hits `UNIQUE(call_id)` and returns "duplicate." Revenue from the second deal is **never** sent to Google. Internal reporting may show both (if stored elsewhere), but OCI attribution is understated. The system's drive for "one conversion per call" — a reasonable business rule — leads to **data nihilism** when the rule is too strict for the real world.

For V2_PULSE: Two leads convert within 24h with the same gclid. The second is dropped. Marketing loses visibility into the second conversion; ROAS is understated.

### 3.4 The Axiomatic Correction

1. **Order ID:** Current design (rowId + suffix) is sound; retain.
2. **V2_PULSE dedup:** Consider relaxing to "one per call_id per 24h" only when call_id is present; when deduping by gclid, document that multi-conversion sessions are collapsed and accept product trade-off or add `conversion_sequence` to allow multiple per session.
3. **Seal / call_id:** Document that `UNIQUE(call_id)` enforces one OCI conversion per call. If business requires multiple conversions per call, introduce a synthetic discriminator (e.g. `call_id || '_' || sequence`) or a separate table for multi-seal scenarios.
4. **Shadow ledger:** Already implemented — `shadow_decisions` records rejected paths. Use for counterfactual analytics and A/B re-simulation; does not restore the dropped value for Google.

---

## 4. The Halting Paradox (Recursive Collapse)

### 4.1 The Singularity

**Infinite Mirror: Unbounded Retries and Poison-Pill Cascades**

### 4.2 The Ontological Flaw

**Turing's Halting Problem:** Can the system decide, in finite time, whether a given row will reach a terminal state?

**OCI path:** `MAX_RETRY_ATTEMPTS = 7` → after 7 failures, status = FAILED. **Halting guaranteed.**

**Fallback path (OMEGA 2.1):** PENDING → claim → PROCESSING → publish to QStash → success: RECOVERED (terminal); failure: PENDING. There is **no** `recover_attempt_count` or max retries. A row that QStash always rejects (e.g. payload too large, permanent API bug) will cycle PENDING → PROCESSING → PENDING **forever**. The system **never** decides "this row is unrecoverable." **Semantic non-halting.**

**Poison-pill cascade (Extinction 2.2):** One row in an OCI batch throws in `queueRowToConversionJob` (e.g. malformed payload, getter that throws). The **entire** batch throws. The runner marks **all** rows in the batch as RETRY. After 7 attempts, **all** — including healthy rows — are FAILED. One poison pill **blocks and kills** the batch. This is not recursive collapse but **batch asphyxiation**.

**Infinite Mirror:** For fallback, a single event that can never be published triggers retries every 5 minutes indefinitely. Each retry: claim, publish (fails), bulk update PENDING. The "cost" of the original error (one lost event) is small. The cost of **unbounded retries** — cron runs, QStash API calls, DB updates — grows without bound. The system spends more energy trying to fix the error than the error's original cost.

**Compensation loop:** Is there "retry → compensation fails → retry compensation"? The idempotency path has **no** compensation on processSyncEvent failure (Extinction 1.1). The fallback has no compensation — only retry. So no **direct** compensation death loop. The infinite loop is the retry itself.

### 4.3 The Simulation Failure

**Ghost in the Machine:** A sync payload that is 1MB (over QStash limit) lands in fallback. Every 5 minutes the recover cron claims it, tries to publish, fails. The row stays PENDING. This continues until manual intervention or the heat death of the universe. Logs fill with RECOVER_FALLBACK_PUBLISH_FAILED. No alert that "this row will never recover" — the system cannot know.

For OCI: One malformed row (e.g. `conversion_time` as an object) causes `queueRowToConversionJob` to throw. The whole batch of 50 rows is retried. After 7 runs, 50 rows are FAILED — 49 of which would have succeeded. One poison pill causes 49 "good" conversions to be marked unrecoverable.

### 4.4 The Axiomatic Correction

1. **Fallback: Bounded retries (Oracle for unrecoverability):** Add `recover_attempt_count` to `ingest_fallback_buffer`. Increment on each failed publish. After N attempts (e.g. 10), transition to FAILED or DLQ. The system **decides** in finite time that the row will not be recovered by the normal path.

2. **OCI: Per-row try/catch:** In the runner, wrap `queueRowToConversionJob(row)` in try/catch. On throw, mark **that row** FAILED (or quarantine), log, and **continue** with the rest. Do not let one poison pill kill the batch.

3. **Payload validation:** Validate conversion payloads (conversion_time, value_cents, etc.) **before** batch processing; filter invalid rows into quarantine before upload.

4. **Alerting:** Alert when `recover_attempt_count` approaches N, or when fallback PENDING count grows without RECOVERED growth over 24h — signals systemic unrecoverability.

---

## Summary Matrix

| Anomaly                    | Singularity                  | Ontological Flaw                           | Simulation Failure                    | Axiomatic Correction                          |
|---------------------------|-----------------------------|--------------------------------------------|---------------------------------------|-----------------------------------------------|
| Observer's Paradox        | Phantom PROCESSING          | Incomplete observation leaves state undecidable | Zombie rows in ingest_fallback        | Turing Oracle: PROCESSING→PENDING recovery     |
| Chronological Entropy     | Temporal Poisoning          | Time as scalar; no sanity window           | Corrupted sort order; wrong attribution | Reject bad timestamps; defensive sort          |
| Identity Singularity      | Data Nihilism               | Dedup collapses distinct intents           | Lost revenue from strict UNIQUE/dedup  | Relax rules where safe; document trade-offs    |
| Halting Paradox           | Infinite Mirror             | Fallback never halts; poison pill kills batch | Unbounded retries; batch-wide FAILED   | Bounded retries; per-row try/catch             |

---

## Causal Proof: Axiomatic Corrections Applied

**Migration:** `20260325000000_axiomatic_causal_integrity.sql`  
**Logic refactors:** Recover cron, temporal-sanity, orchestrator, OCI runner, sales, enqueue-seal, google-ads-export

### How These Changes Close the Fractures

1. **Observer's Paradox (Phantom State)** — The 5-min recover cron now calls `recover_stuck_ingest_fallback(15)` at the start of each run. Any row in PROCESSING for more than 15 minutes is reset to PENDING. No row is "unwitnessed" for more than 15 minutes. The state machine is **decidable**: every non-terminal state (PROCESSING) has a provable transition (→ PENDING) within the axiom set.

2. **Chronological Entropy (Temporal Poisoning)** — `lib/utils/temporal-sanity.ts` defines `[now - 90 days, now + 1 hour]`. The sales route and enqueue-seal reject `occurredAt` / `confirmedAt` outside this window. The google-ads-export uses `safeConversionTimeMs` for defensive sorting: rows with NaN or invalid dates are placed last and do not corrupt the batch order.

3. **Identity Singularity (Data Nihilism)** — V2_PULSE dedup is bypassed when `discriminator` is present. Clients can send `discriminator: sequence` or `discriminator: timestamp` to allow multiple intents per session. Order ID (rowId + suffix) remains the primary source of uniqueness for Google Ads; the UNIQUE(call_id) constraint is unchanged (product decision).

4. **Halting Paradox (Infinite Mirror & Poison Pills)** — `recover_attempt_count` is incremented on each failed publish. At 10, the row transitions to QUARANTINE (terminal). The system **halts** for that row. Per-row try/catch in the OCI runner isolates poison pills: if `queueRowToConversionJob` throws, only that row is marked FAILED; the remaining rows proceed. One bullet does not stop the tank.

---

**End of Causal Integrity Report**
